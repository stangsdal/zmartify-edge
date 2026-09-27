from __future__ import annotations

import io
import json

import pytest

from app.geocoding import GeocodingError, geocode_address, reverse_geocode


class _Response(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        self.close()


def test_geocode_address_returns_normalized_location(monkeypatch):
    def fake_urlopen(request, timeout):
        assert request.full_url.startswith("https://nominatim.openstreetmap.org/search?")
        assert "q=Radhuspladsen+1" in request.full_url
        assert timeout == 8
        return _Response(json.dumps([{"display_name": "Radhuspladsen 1, 1550 Copenhagen", "lat": "55.6759", "lon": "12.5683"}]).encode())

    monkeypatch.setattr("app.geocoding.urlopen", fake_urlopen)

    location = geocode_address(" Radhuspladsen 1 ")

    assert location.address == "Radhuspladsen 1, 1550 Copenhagen"
    assert location.latitude == 55.6759
    assert location.longitude == 12.5683


def test_reverse_geocode_returns_address(monkeypatch):
    monkeypatch.setattr(
        "app.geocoding.urlopen",
        lambda request, timeout: _Response(json.dumps({"display_name": "Radhuspladsen 1, 1550 Copenhagen", "lat": "55.6759", "lon": "12.5683"}).encode()),
    )

    location = reverse_geocode(55.6759, 12.5683)

    assert location.address == "Radhuspladsen 1, 1550 Copenhagen"


def test_reverse_geocode_rejects_invalid_coordinates():
    with pytest.raises(GeocodingError, match="outside the valid range"):
        reverse_geocode(91, 12)