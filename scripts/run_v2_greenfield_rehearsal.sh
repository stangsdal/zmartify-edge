#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_DIR="$ROOT_DIR/zmartify-edge-api"
PYTHON_BIN="${PYTHON_BIN:-$ROOT_DIR/.venv/bin/python}"
ALEMBIC_BIN="${ALEMBIC_BIN:-$ROOT_DIR/.venv/bin/alembic}"

printf "[stage-gate] Using root: %s\n" "$ROOT_DIR"
printf "[stage-gate] Using python: %s\n" "$PYTHON_BIN"

if [[ ! -x "$PYTHON_BIN" ]]; then
  echo "[stage-gate] Missing Python executable: $PYTHON_BIN" >&2
  exit 1
fi

if [[ ! -x "$ALEMBIC_BIN" ]]; then
  echo "[stage-gate] Missing Alembic executable: $ALEMBIC_BIN" >&2
  exit 1
fi

printf "[phase-1] Validate compose merge with staging enforce\n"
cd "$ROOT_DIR"
docker compose -f docker-compose.yml -f docker-compose.staging.yml config >/tmp/zmartify-stage-gate-compose.yml
grep -q "ZMART_EDGE_CONTRACT_VALIDATION_MODE: enforce" /tmp/zmartify-stage-gate-compose.yml

printf "[phase-1] Validate Alembic on empty database\n"
cd "$API_DIR"
DATABASE_URL=sqlite:///./tmp-stage-gate.db "$ALEMBIC_BIN" -c alembic.ini upgrade head
rm -f tmp-stage-gate.db

printf "[phase-2/3] Run focused API tests for greenfield create flows and contract enforcement\n"
"$PYTHON_BIN" -m pytest -q tests/test_registry_dual_write_v2.py tests/test_domain_model_mobile_api.py \
  -k "dual_write_when_core_v2_tables_exist or contract_enforce_rejects_invalid_twin_timestamp"

printf "[phase-2] Run API v2 core routing and UUID-first adapter tests\n"
"$PYTHON_BIN" -m pytest -q tests/test_api_v2_core.py

printf "[phase-2] Run API v2 auth/users and mqtt client adapter tests\n"
"$PYTHON_BIN" -m pytest -q tests/test_api_v2_auth_mqtt.py

printf "[phase-2] Run API v2 mobile/events adapter tests\n"
"$PYTHON_BIN" -m pytest -q tests/test_api_v2_mobile_events.py

printf "[phase-2] Run API v2 device-lifecycle adapter tests\n"
"$PYTHON_BIN" -m pytest -q tests/test_api_v2_device_lifecycle.py

printf "[phase-2] Run API v2 device-domain adapter tests\n"
"$PYTHON_BIN" -m pytest -q tests/test_api_v2_device_domain.py

printf "[phase-2] Run API v2 OTA adapter tests\n"
"$PYTHON_BIN" -m pytest -q tests/test_api_v2_device_ota.py

printf "[phase-2] Run API v2 mobile websocket adapter tests\n"
"$PYTHON_BIN" -m pytest -q tests/test_api_v2_mobile_ws.py

printf "[phase-4] Run MQTT-related regression tests\n"
"$PYTHON_BIN" -m pytest -q tests/test_mqtt_clients.py tests/test_mqtt_security.py

if [[ "${RUN_LIVE_HVAC:-0}" == "1" ]]; then
  printf "[phase-7-smoke] Running optional live HVAC contract tests\n"
  "$PYTHON_BIN" -m pytest -q tests/test_live_hvac_contract.py
fi

printf "[stage-gate] SUCCESS: Greenfield rehearsal checks passed.\n"
