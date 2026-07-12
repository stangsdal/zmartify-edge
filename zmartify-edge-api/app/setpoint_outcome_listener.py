from __future__ import annotations

import json
import os
import threading
import uuid
from collections.abc import Callable
from typing import Any

from app.contracts import ContractValidationError
from app.mqtt_v2_ingest import parse_mqtt_v2_setpoint_outcome_payload
from app.mqtt_v2_topics import outcome_subscription_topics, parse_setpoint_outcome_topic, parse_v2_device_event_topic


class SetpointOutcomeMqttListener:
    def __init__(
        self,
        list_devices_fn: Callable[[], list[dict]],
        get_device_mqtt_credentials_fn: Callable[[str], dict],
        ingest_setpoint_command_outcome_fn: Callable[..., None],
        mqtt_client_module: Any = None,
        ingest_irrigation_outcome_fn: Callable[..., None] | None = None,
        ingest_reported_state_fn: Callable[..., None] | None = None,
    ) -> None:
        self._list_devices = list_devices_fn
        self._get_device_mqtt_credentials = get_device_mqtt_credentials_fn
        self._ingest_setpoint_command_outcome = ingest_setpoint_command_outcome_fn
        self._ingest_irrigation_outcome = ingest_irrigation_outcome_fn
        self._ingest_reported_state = ingest_reported_state_fn
        self._mqtt = mqtt_client_module
        self._clients: dict[str, Any] = {}
        self._threads: dict[str, threading.Thread] = {}
        self._running = False

    @staticmethod
    def _mqtt_host() -> str:
        return os.getenv("MQTT_HOST", "mosquitto").strip() or "mosquitto"

    @staticmethod
    def _mqtt_port() -> int:
        raw = os.getenv("MQTT_PORT", "1883").strip() or "1883"
        try:
            return int(raw)
        except ValueError:
            return 1883

    @staticmethod
    def _base_topic() -> str:
        return os.getenv("ZMART_EDGE_COMMAND_MQTT_BASE", "homie/5").strip().rstrip("/") or "homie/5"

    @staticmethod
    def _enabled() -> bool:
        raw = os.getenv("ZMART_EDGE_ENABLE_SETPOINT_OUTCOME_LISTENER", "1")
        return raw.strip().lower() in {"1", "true", "yes", "on"}

    @staticmethod
    def _device_id_override() -> str:
        return os.getenv("ZMART_EDGE_SETPOINT_OUTCOME_DEVICE_ID", "").strip()

    @staticmethod
    def _parse_zone_topic(topic: str) -> tuple[str, int] | None:
        return parse_setpoint_outcome_topic(topic)

    def _handle_last_setpoint_command(self, device_id: str, zone_id: int, payload_text: str) -> None:
        try:
            data = json.loads(payload_text)
        except json.JSONDecodeError:
            return

        result = str(data.get("result") or "").strip().lower()
        if not result:
            return
        requested = data.get("requested")
        confirmed = data.get("confirmed")
        detail = data.get("detail")
        self._ingest_setpoint_command_outcome(
            device_id,
            zone_id,
            result=result,
            detail=str(detail) if detail is not None else None,
            requested_target_c=float(requested) if isinstance(requested, (int, float)) else None,
            confirmed_target_c=float(confirmed) if isinstance(confirmed, (int, float)) else None,
            payload={"source": "mqtt_last_setpoint_command", "raw": data},
        )

    def _handle_v2_setpoint_outcome(self, device_id: str, zone_id: int, payload_text: str) -> None:
        try:
            data = json.loads(payload_text)
        except json.JSONDecodeError:
            return

        if not isinstance(data, dict):
            return

        try:
            normalized = parse_mqtt_v2_setpoint_outcome_payload(data)
        except ContractValidationError:
            return

        self._ingest_setpoint_command_outcome(
            device_id,
            zone_id,
            result=normalized["result"],
            detail=normalized["detail"],
            requested_target_c=normalized["requested_target_c"],
            confirmed_target_c=normalized["confirmed_target_c"],
            payload={"source": "mqtt_v2_setpoint_outcome", "raw": normalized["raw"]},
        )

    def _on_connect(self, client, userdata, _flags, _rc):
        device_id = str(userdata or "").strip()
        if not device_id:
            return
        for topic in outcome_subscription_topics(device_id):
            client.subscribe(topic, qos=1)

    def _on_message(self, _client, _userdata, msg):
        topic = str(msg.topic or "")
        payload_text = (msg.payload or b"").decode("utf-8", errors="ignore").strip()
        if not payload_text:
            return

        v2_event = parse_v2_device_event_topic(topic)
        if v2_event is not None:
            device_id, kind = v2_event
            try:
                data = json.loads(payload_text)
            except json.JSONDecodeError:
                return
            if not isinstance(data, dict):
                return
            try:
                if kind == "irrigation_outcome" and self._ingest_irrigation_outcome is not None:
                    self._ingest_irrigation_outcome(device_id, data)
                elif kind == "reported_state" and self._ingest_reported_state is not None:
                    self._ingest_reported_state(device_id, data)
            except ContractValidationError:
                return
            except Exception:
                return
            return

        parsed = self._parse_zone_topic(topic)
        if parsed is None:
            return
        device_id, zone_id = parsed
        if topic.endswith("/last-setpoint-command"):
            self._handle_last_setpoint_command(device_id, zone_id, payload_text)
            return
        if topic.endswith("/setpoint-outcome"):
            self._handle_v2_setpoint_outcome(device_id, zone_id, payload_text)

    def _device_listener_targets(self) -> list[tuple[str, str, str]]:
        override = self._device_id_override()
        devices = self._list_devices()
        targets: list[tuple[str, str, str]] = []
        for item in devices:
            device_id = str(item.get("device_id") or "").strip()
            if not device_id:
                continue
            if override and device_id != override:
                continue
            try:
                creds = self._get_device_mqtt_credentials(device_id)
            except Exception:
                continue
            username = str(creds.get("username") or "").strip()
            password = str(creds.get("password") or "").strip()
            if not username or not password:
                continue
            targets.append((device_id, username, password))
        return targets

    def start(self) -> None:
        if not self._enabled() or self._mqtt is None or self._running:
            return

        targets = self._device_listener_targets()
        for device_id, username, password in targets:
            client = self._mqtt.Client(client_id=f"edge-setpoint-{device_id}-{uuid.uuid4().hex[:6]}", userdata=device_id)
            client.username_pw_set(username=username, password=password)
            client.on_connect = self._on_connect
            client.on_message = self._on_message
            client.connect(self._mqtt_host(), self._mqtt_port(), keepalive=30)
            thread = threading.Thread(
                target=client.loop_forever,
                name=f"setpoint-outcome-{device_id}",
                daemon=True,
            )
            thread.start()
            self._clients[device_id] = client
            self._threads[device_id] = thread

        self._running = True

    def stop(self) -> None:
        if not self._running:
            return
        for client in self._clients.values():
            try:
                client.disconnect()
            except Exception:
                pass
        self._clients.clear()
        self._threads.clear()
        self._running = False


def create_setpoint_outcome_listener() -> SetpointOutcomeMqttListener:
    try:
        import paho.mqtt.client as mqtt_client_module
    except Exception:  # pragma: no cover
        mqtt_client_module = None

    from app.domain_model import ingest_setpoint_command_outcome
    from app.mqtt_v2_ingest import ingest_mqtt_v2_irrigation_outcome, ingest_mqtt_v2_reported_state
    from app.registry import get_device_mqtt_credentials, list_devices

    return SetpointOutcomeMqttListener(
        list_devices_fn=list_devices,
        get_device_mqtt_credentials_fn=get_device_mqtt_credentials,
        ingest_setpoint_command_outcome_fn=ingest_setpoint_command_outcome,
        mqtt_client_module=mqtt_client_module,
        ingest_irrigation_outcome_fn=ingest_mqtt_v2_irrigation_outcome,
        ingest_reported_state_fn=lambda device_id, payload: ingest_mqtt_v2_reported_state(
            device_id, payload, source="mqtt_v2_state_reported"
        ),
    )
