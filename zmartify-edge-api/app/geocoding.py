from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


class GeocodingError(RuntimeError):
    pass


@dataclass(frozen=True)
class GeocodedLocation:
    address: str
    latitude: float
    longitude: float


def _request_json(path: str, params: dict[str, str]) -> Any:
    base_url = os.getenv("ZMART_EDGE_GEOCODING_URL", "https://nominatim.openstreetmap.org").rstrip("/")
    request = Request(
        f"{base_url}/{path}?{urlencode(params)}",
        headers={"User-Agent": "Zmartify-Edge/0.1 (https://zmartify.dk)"},
    )
    try:
        with urlopen(request, timeout=8) as response:
            return json.load(response)
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise GeocodingError("address service is unavailable") from exc


def _location(result: dict[str, Any]) -> GeocodedLocation:
    try:
        address = str(result["display_name"]).strip()
        latitude = float(result["lat"])
        longitude = float(result["lon"])
    except (KeyError, TypeError, ValueError) as exc:
        raise GeocodingError("address service returned an invalid location") from exc
    if not address or not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
        raise GeocodingError("address service returned an invalid location")
    return GeocodedLocation(address=address, latitude=latitude, longitude=longitude)


def geocode_address(address: str) -> GeocodedLocation:
    query = address.strip()
    if not query:
        raise GeocodingError("address is required")
    results = _request_json("search", {"q": query, "format": "jsonv2", "limit": "1"})
    if not isinstance(results, list) or not results:
        raise GeocodingError("address was not found")
    return _location(results[0])


def reverse_geocode(latitude: float, longitude: float) -> GeocodedLocation:
    if not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
        raise GeocodingError("coordinates are outside the valid range")
    result = _request_json(
        "reverse",
        {"lat": str(latitude), "lon": str(longitude), "format": "jsonv2", "zoom": "18"},
    )
    if not isinstance(result, dict) or "error" in result:
        raise GeocodingError("address was not found")
    return _location(result)