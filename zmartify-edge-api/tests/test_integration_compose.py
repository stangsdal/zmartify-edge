from __future__ import annotations

import json
import os
import re
import subprocess
import textwrap
import time
import uuid
from pathlib import Path
from urllib import error, request

import pytest


pytestmark = pytest.mark.skipif(
    os.getenv("RUN_COMPOSE_INTEGRATION") != "1",
    reason="set RUN_COMPOSE_INTEGRATION=1 to run compose integration tests",
)


def _run(cmd: list[str], cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, check=True)


def _compose(project: str, compose_file: Path, args: list[str]) -> subprocess.CompletedProcess[str]:
    cmd = [
        "docker",
        "compose",
        "-p",
        project,
        "-f",
        str(compose_file),
        *args,
    ]
    return _run(cmd)


def _api_call(base_url: str, method: str, path: str, payload: dict | None = None) -> dict | None:
    data = None
    headers: dict[str, str] = {}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"

    req = request.Request(base_url + path, data=data, method=method, headers=headers)
    with request.urlopen(req, timeout=20) as resp:
        body = resp.read().decode("utf-8")
        return json.loads(body) if body else None


def _wait_for_health(base_url: str, timeout_sec: int = 120) -> None:
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        try:
            _api_call(base_url, "GET", "/health")
            return
        except Exception:
            time.sleep(1)
    raise TimeoutError("api health endpoint did not become ready")


def _wait_for_acl_line(acl_path: Path, expected: bool, pattern: str, timeout_sec: int = 30) -> None:
    regex = re.compile(pattern)
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        content = acl_path.read_text(encoding="utf-8") if acl_path.exists() else ""
        present = bool(regex.search(content))
        if present == expected:
            return
        time.sleep(0.5)
    state = "present" if expected else "absent"
    raise AssertionError(f"ACL line not {state}: {pattern}")


def test_compose_acl_lifecycle(tmp_path: Path) -> None:
    api_root = Path(__file__).resolve().parents[1]

    config_dir = tmp_path / "mosquitto-config"
    data_dir = tmp_path / "mosquitto-data"
    log_dir = tmp_path / "mosquitto-log"
    config_dir.mkdir(parents=True, exist_ok=True)
    data_dir.mkdir(parents=True, exist_ok=True)
    log_dir.mkdir(parents=True, exist_ok=True)

    mosquitto_conf = textwrap.dedent(
        """
        persistence true
        persistence_location /mosquitto/data/

        log_dest stdout

        allow_anonymous false
        password_file /mosquitto/config/passwd
        acl_file /mosquitto/config/acl

        listener 1883
        protocol mqtt
        """
    ).strip() + "\n"
    (config_dir / "mosquitto.conf").write_text(mosquitto_conf, encoding="utf-8")
    (config_dir / "passwd").write_text("", encoding="utf-8")
    (config_dir / "acl").write_text("", encoding="utf-8")

    compose_file = tmp_path / "docker-compose.integration.yml"
    compose_file.write_text(
        textwrap.dedent(
            f"""
            services:
              mosquitto:
                image: eclipse-mosquitto:2
                volumes:
                  - {config_dir}:/mosquitto/config
                  - {data_dir}:/mosquitto/data
                  - {log_dir}:/mosquitto/log

              api:
                build:
                  context: {api_root}
                  dockerfile: Dockerfile
                depends_on:
                  - mosquitto
                ports:
                  - "0:8080"
                volumes:
                  - {config_dir}:/mosquitto/config
                  - api-data:/data
                environment:
                  - MQTT_HOST=mosquitto
                  - MQTT_PORT=1883
                  - ZMART_EDGE_DB_PATH=/data/hvac-edge.sqlite
                  - ZMART_EDGE_APPLY_MQTT_COMMANDS=1
                  - ZMART_EDGE_MQTT_ACL_FILE=/mosquitto/config/acl
                  - ZMART_EDGE_MQTT_PASSWD_FILE=/mosquitto/config/passwd
                  - ZMART_EDGE_MOSQUITTO_PASSWD_BIN=/usr/bin/mosquitto_passwd
                  - ZMART_EDGE_MQTT_RELOAD_CMD=true
                  - ZMART_EDGE_MQTT_RESTART_CMD=true
                  - ZMART_EDGE_DRY_RUN_ACL_WRITE=0

            volumes:
              api-data:
            """
        ).strip()
        + "\n",
        encoding="utf-8",
    )

    project = f"hvacint_{uuid.uuid4().hex[:8]}"
    try:
        _compose(project, compose_file, ["up", "-d", "--build"])

        port_out = _compose(project, compose_file, ["port", "api", "8080"]).stdout.strip()
        host_port = port_out.rsplit(":", 1)[1]
        base_url = f"http://127.0.0.1:{host_port}"

        _wait_for_health(base_url)

        domain = _api_call(base_url, "POST", "/domains", {"slug": "house", "name": "House"})
        assert domain is not None

        site = _api_call(
            base_url,
            "POST",
            f"/domains/{domain['id']}/sites",
            {"slug": "ground", "name": "Ground"},
        )
        assert site is not None

        device_id = "hvac-gateway-int-01"
        _api_call(
            base_url,
            "POST",
            "/devices",
            {
                "device_id": device_id,
                "display_name": "Gateway",
                "mac": None,
                "firmware_version": "0.4.0",
            },
        )
        _api_call(
            base_url,
            "POST",
            f"/devices/{device_id}/assign-site",
            {"site_id": site["id"]},
        )

        username = "ha_house"
        created = _api_call(
            base_url,
            "POST",
            "/mqtt/clients",
            {
                "client_type": "homeassistant",
                "domain_id": domain["id"],
                "site_id": site["id"],
                "device_id": None,
                "username": username,
            },
        )
        assert created is not None
        client_id = created["mqtt_client_id"]

        acl_path = config_dir / "acl"
        _wait_for_acl_line(acl_path, True, rf"^user {username}$")
        _wait_for_acl_line(
            acl_path,
            True,
            rf"^topic write homie/5/{device_id}/\+/target-temperature/set$",
        )

        _api_call(base_url, "POST", f"/mqtt/clients/{client_id}/disable")
        _wait_for_acl_line(acl_path, False, rf"^user {username}$")

        _api_call(base_url, "POST", f"/mqtt/clients/{client_id}/enable")
        _wait_for_acl_line(acl_path, True, rf"^user {username}$")

        _api_call(base_url, "DELETE", f"/mqtt/clients/{client_id}")
        _wait_for_acl_line(acl_path, False, rf"^user {username}$")
    finally:
        _compose(project, compose_file, ["down", "-v", "--remove-orphans"])
