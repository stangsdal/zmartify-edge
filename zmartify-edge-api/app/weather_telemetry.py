from __future__ import annotations

import json
import logging
import os
import threading
import uuid
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from app.db import get_connection
from app.domain_model import _ensure_hvac_projection_schema


logger = logging.getLogger("uvicorn.error").getChild("weather_telemetry")
_WEATHER_FIELDS = (
    "temperature_2m",
    "apparent_temperature",
    "relative_humidity_2m",
    "precipitation",
    "cloud_cover",
    "surface_pressure",
    "wind_speed_10m",
    "wind_direction_10m",
    "shortwave_radiation",
    "weather_code",
)


def _env_seconds(name: str, default: int, minimum: int) -> int:
    try:
        return max(minimum, int(os.getenv(name, str(default))))
    except ValueError:
        return default


def _utc_iso(value: str) -> str:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC).replace(microsecond=0).isoformat()


def fetch_open_meteo(latitude: float, longitude: float) -> dict[str, Any]:
    params = {
        "latitude": str(latitude),
        "longitude": str(longitude),
        "timezone": "UTC",
        "forecast_days": "7",
        "current": ",".join(_WEATHER_FIELDS),
        "hourly": ",".join(_WEATHER_FIELDS),
    }
    base_url = os.getenv("ZMART_EDGE_WEATHER_URL", "https://api.open-meteo.com/v1/forecast")
    request = Request(f"{base_url}?{urlencode(params)}", headers={"User-Agent": "Zmartify-Edge/0.1"})
    with urlopen(request, timeout=10) as response:
        payload = json.load(response)
    if not isinstance(payload, dict):
        raise ValueError("weather provider returned an invalid response")
    return payload


def _weather_values(values: dict[str, Any]) -> tuple[Any, ...]:
    return (
        values.get("temperature_2m"),
        values.get("apparent_temperature"),
        values.get("relative_humidity_2m"),
        values.get("precipitation"),
        values.get("cloud_cover"),
        values.get("surface_pressure"),
        values.get("wind_speed_10m"),
        values.get("wind_direction_10m"),
        values.get("shortwave_radiation"),
        values.get("weather_code"),
    )


class WeatherTelemetryCollector:
    def __init__(
        self,
        *,
        weather_fetcher: Callable[[float, float], dict[str, Any]] = fetch_open_meteo,
        now_fn: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self._weather_fetcher = weather_fetcher
        self._now = now_fn
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None

    @staticmethod
    def enabled() -> bool:
        return os.getenv("ZMART_EDGE_ENABLE_WEATHER_TELEMETRY", "1").strip().lower() in {"1", "true", "yes", "on"}

    @staticmethod
    def weather_interval_seconds() -> int:
        return _env_seconds("ZMART_EDGE_WEATHER_INTERVAL_SECONDS", 1800, 300)

    @staticmethod
    def telemetry_interval_seconds() -> int:
        return _env_seconds("ZMART_EDGE_TELEMETRY_INTERVAL_SECONDS", 300, 60)

    @staticmethod
    def retention_days() -> int:
        return _env_seconds("ZMART_EDGE_MODEL_HISTORY_RETENTION_DAYS", 730, 30)

    def _store_weather_row(
        self,
        conn: Any,
        *,
        site_id: int,
        kind: str,
        weather_at: str,
        fetched_at: str,
        values: dict[str, Any],
    ) -> None:
        conn.execute(
            """
            INSERT INTO site_weather(
                uuid, site_id, kind, weather_at, fetched_at, temperature_c,
                apparent_temperature_c, relative_humidity_percent, precipitation_mm,
                cloud_cover_percent, surface_pressure_hpa, wind_speed_kmh,
                wind_direction_degrees, shortwave_radiation_wm2, weather_code, provider
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open-meteo')
            ON CONFLICT(site_id, kind, weather_at) DO UPDATE SET
                fetched_at = excluded.fetched_at,
                temperature_c = excluded.temperature_c,
                apparent_temperature_c = excluded.apparent_temperature_c,
                relative_humidity_percent = excluded.relative_humidity_percent,
                precipitation_mm = excluded.precipitation_mm,
                cloud_cover_percent = excluded.cloud_cover_percent,
                surface_pressure_hpa = excluded.surface_pressure_hpa,
                wind_speed_kmh = excluded.wind_speed_kmh,
                wind_direction_degrees = excluded.wind_direction_degrees,
                shortwave_radiation_wm2 = excluded.shortwave_radiation_wm2,
                weather_code = excluded.weather_code,
                provider = excluded.provider
            """,
            (str(uuid.uuid4()), site_id, kind, weather_at, fetched_at, *_weather_values(values)),
        )

    def collect_weather_once(self) -> int:
        fetched_at = self._now().astimezone(UTC).replace(microsecond=0).isoformat()
        with get_connection() as conn:
            sites = conn.execute(
                "SELECT id, latitude, longitude FROM sites WHERE latitude IS NOT NULL AND longitude IS NOT NULL"
            ).fetchall()

        stored = 0
        for site in sites:
            try:
                payload = self._weather_fetcher(float(site["latitude"]), float(site["longitude"]))
                current = payload.get("current")
                hourly = payload.get("hourly")
                with get_connection() as conn:
                    if isinstance(current, dict) and isinstance(current.get("time"), str):
                        self._store_weather_row(
                            conn,
                            site_id=int(site["id"]),
                            kind="observation",
                            weather_at=_utc_iso(current["time"]),
                            fetched_at=fetched_at,
                            values=current,
                        )
                        stored += 1
                    if isinstance(hourly, dict) and isinstance(hourly.get("time"), list):
                        for index, raw_time in enumerate(hourly["time"]):
                            if not isinstance(raw_time, str):
                                continue
                            values = {
                                field: series[index]
                                for field in _WEATHER_FIELDS
                                if isinstance((series := hourly.get(field)), list) and index < len(series)
                            }
                            self._store_weather_row(
                                conn,
                                site_id=int(site["id"]),
                                kind="forecast",
                                weather_at=_utc_iso(raw_time),
                                fetched_at=fetched_at,
                                values=values,
                            )
                            stored += 1
            except Exception:
                logger.exception("Weather collection failed for site_id=%s", site["id"])
        return stored

    def sample_hvac_once(self) -> int:
        interval = self.telemetry_interval_seconds()
        now = self._now().astimezone(UTC)
        sampled_at = datetime.fromtimestamp(int(now.timestamp()) // interval * interval, tz=UTC).isoformat()
        with get_connection() as conn:
            _ensure_hvac_projection_schema(conn)
            rows = conn.execute(
                """
                SELECT d.site_id, d.id AS device_id, zs.zone_id, zs.source_timestamp,
                       zs.current_temperature, zs.target_temperature, zs.floor_temperature_c,
                       zs.demand, zs.active, zs.zone_mode, zs.battery_percent,
                       zs.rssi_element_dbm, zs.rssi_control_unit_dbm,
                       hc.inlet_temperature_c, hc.dhw_temperature_c, hc.total_current_ma
                FROM devices d
                JOIN zone_state zs ON zs.device_id = d.id
                LEFT JOIN hvac_controller_state hc ON hc.device_id = d.id
                WHERE d.site_id IS NOT NULL AND d.device_type = 'hvac_ahc9000'
                """
            ).fetchall()
            for row in rows:
                conn.execute(
                    """
                    INSERT INTO hvac_telemetry_samples(
                        uuid, site_id, device_id, zone_id, sampled_at, source_timestamp,
                        current_temperature_c, target_temperature_c, floor_temperature_c,
                        demand, active, zone_mode, battery_percent, rssi_element_dbm,
                        rssi_control_unit_dbm, inlet_temperature_c, dhw_temperature_c, total_current_ma
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(device_id, zone_id, sampled_at) DO NOTHING
                    """,
                    (
                        str(uuid.uuid4()), row["site_id"], row["device_id"], row["zone_id"], sampled_at,
                        row["source_timestamp"], row["current_temperature"], row["target_temperature"],
                        row["floor_temperature_c"], row["demand"], row["active"], row["zone_mode"],
                        row["battery_percent"], row["rssi_element_dbm"], row["rssi_control_unit_dbm"],
                        row["inlet_temperature_c"], row["dhw_temperature_c"], row["total_current_ma"],
                    ),
                )
            cutoff = (now - timedelta(days=self.retention_days())).replace(microsecond=0).isoformat()
            conn.execute("DELETE FROM hvac_telemetry_samples WHERE sampled_at < ?", (cutoff,))
            conn.execute("DELETE FROM site_weather WHERE weather_at < ?", (cutoff,))
        return len(rows)

    def _run(self) -> None:
        next_weather = 0.0
        next_telemetry = 0.0
        while not self._stop_event.is_set():
            now_timestamp = self._now().timestamp()
            if now_timestamp >= next_weather:
                try:
                    self.collect_weather_once()
                except Exception:
                    logger.exception("Weather collection cycle failed")
                next_weather = now_timestamp + self.weather_interval_seconds()
            if now_timestamp >= next_telemetry:
                try:
                    self.sample_hvac_once()
                except Exception:
                    logger.exception("HVAC telemetry sampling cycle failed")
                next_telemetry = now_timestamp + self.telemetry_interval_seconds()
            self._stop_event.wait(min(next_weather, next_telemetry) - now_timestamp)

    def start(self) -> None:
        if not self.enabled() or self._thread is not None:
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run, name="weather-telemetry", daemon=True)
        self._thread.start()
        logger.info("Started weather and HVAC telemetry collector")

    def stop(self) -> None:
        self._stop_event.set()
        if self._thread is not None:
            self._thread.join(timeout=5)
            self._thread = None


def get_site_weather(site_ref: str, *, forecast_hours: int = 48) -> dict[str, Any]:
    now = datetime.now(UTC).replace(microsecond=0)
    forecast_end = (now + timedelta(hours=max(1, min(168, forecast_hours)))).isoformat()
    with get_connection() as conn:
        site = conn.execute(
            "SELECT id, uuid, slug, name, latitude, longitude FROM sites WHERE uuid = ? OR slug = ? OR CAST(id AS TEXT) = ?",
            (site_ref, site_ref, site_ref),
        ).fetchone()
        if site is None:
            raise LookupError("site not found")
        current = conn.execute(
            "SELECT * FROM site_weather WHERE site_id = ? AND kind = 'observation' ORDER BY weather_at DESC LIMIT 1",
            (site["id"],),
        ).fetchone()
        forecasts = conn.execute(
            "SELECT * FROM site_weather WHERE site_id = ? AND kind = 'forecast' AND weather_at >= ? AND weather_at <= ? ORDER BY weather_at",
            (site["id"], now.isoformat(), forecast_end),
        ).fetchall()

    fields = (
        "weather_at", "fetched_at", "temperature_c", "apparent_temperature_c",
        "relative_humidity_percent", "precipitation_mm", "cloud_cover_percent",
        "surface_pressure_hpa", "wind_speed_kmh", "wind_direction_degrees",
        "shortwave_radiation_wm2", "weather_code", "provider",
    )
    serialize = lambda row: {field: row[field] for field in fields} if row is not None else None
    return {
        "site_id": site["uuid"] or site["slug"],
        "site_name": site["name"],
        "latitude": site["latitude"],
        "longitude": site["longitude"],
        "current": serialize(current),
        "forecast": [serialize(row) for row in forecasts],
    }