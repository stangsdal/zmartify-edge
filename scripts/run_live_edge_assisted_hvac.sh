#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON_BIN="${PYTHON_BIN:-$ROOT_DIR/.venv/bin/python}"

if [[ ! -x "$PYTHON_BIN" ]]; then
  echo "Missing Python executable: $PYTHON_BIN" >&2
  exit 1
fi

if [[ -z "${LIVE_EDGE_BASE_URL:-}" || -z "${LIVE_EDGE_BEARER_TOKEN:-}" || -z "${LIVE_EDGE_DEVICE_ID:-}" ]]; then
  echo "LIVE_EDGE_BASE_URL, LIVE_EDGE_BEARER_TOKEN, and LIVE_EDGE_DEVICE_ID must be set for edge-assisted checks."
  echo "Running baseline live HVAC smoke only."
  RUN_LIVE_HVAC=1 LIVE_HVAC_BASE_URL="${LIVE_HVAC_BASE_URL:-http://192.168.10.57}" \
    "$PYTHON_BIN" -m pytest -q "$ROOT_DIR/zmartify-edge-api/tests/test_live_hvac_contract.py"
  exit 0
fi

RUN_LIVE_HVAC=1 \
LIVE_HVAC_BASE_URL="${LIVE_HVAC_BASE_URL:-http://192.168.10.57}" \
LIVE_EDGE_BASE_URL="$LIVE_EDGE_BASE_URL" \
LIVE_EDGE_BEARER_TOKEN="$LIVE_EDGE_BEARER_TOKEN" \
LIVE_EDGE_DEVICE_ID="$LIVE_EDGE_DEVICE_ID" \
LIVE_EDGE_ENABLE_COMMAND_FEEDBACK_TEST=1 \
  "$PYTHON_BIN" -m pytest -q "$ROOT_DIR/zmartify-edge-api/tests/test_live_hvac_contract.py"
