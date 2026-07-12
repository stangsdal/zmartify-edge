# v2 Live Device Test Notes

Purpose:

- Capture repeatable live validation notes for the currently active HVAC controller and upcoming irrigation controller.

## Active Devices

- HVAC: `zmartify-hvac-ahc9000` (live, can be used immediately for validation).
- Irrigation: `zmartify-irrigation` (integration target for later phases).

## How To Execute Live HVAC Smoke Tests

```bash
RUN_LIVE_HVAC=1 LIVE_HVAC_BASE_URL=http://192.168.10.57 \
  /Users/peter/zmartify-edge/.venv/bin/python -m pytest -q \
  zmartify-edge-api/tests/test_live_hvac_contract.py
```

Optional edge-assisted checks (twin-shape + command-feedback smoke):

```bash
RUN_LIVE_HVAC=1 \
LIVE_HVAC_BASE_URL=http://192.168.10.57 \
LIVE_EDGE_BASE_URL=https://pilot.zmartify.dk \
LIVE_EDGE_BEARER_TOKEN=<token> \
LIVE_EDGE_DEVICE_ID=<device_id> \
LIVE_EDGE_ENABLE_COMMAND_FEEDBACK_TEST=1 \
  /Users/peter/zmartify-edge/.venv/bin/python -m pytest -q \
  zmartify-edge-api/tests/test_live_hvac_contract.py
```

Helper script:

`./scripts/run_live_edge_assisted_hvac.sh`

## Evidence To Record Per Run

- Date/time and git commit hash.
- Endpoint reachability and response snapshots.
- Contract enforcement behavior observed in edge logs.
- Any deviations from expected payload shape.
- Required firmware-side adjustments.

## Pass Criteria

- Device responds to health and identity/version checks.
- Onboarding status endpoint is reachable and parseable.
- No breaking contract mismatch for current edge assumptions.

## Latest Execution Evidence

- Date: 2026-07-12
- Command: `RUN_LIVE_HVAC=1 LIVE_HVAC_BASE_URL=http://192.168.10.57 /Users/peter/zmartify-edge/.venv/bin/python -m pytest -q zmartify-edge-api/tests/test_live_hvac_contract.py`
- Result: 3 passed, 2 skipped
- Notes: baseline live HVAC endpoints are reachable; edge-assisted checks remain opt-in and were skipped because edge credentials/flags were not supplied.

- Date: 2026-07-12 (follow-up run)
- Command: `RUN_LIVE_HVAC=1 LIVE_HVAC_BASE_URL=http://192.168.10.57 LIVE_EDGE_ENABLE_COMMAND_FEEDBACK_TEST=1 ... pytest -q zmartify-edge-api/tests/test_live_hvac_contract.py`
- Result: 3 passed, 2 skipped
- Notes: edge-assisted tests still skipped because `LIVE_EDGE_BASE_URL`, `LIVE_EDGE_BEARER_TOKEN`, and/or `LIVE_EDGE_DEVICE_ID` were empty in shell environment.

- Date: 2026-07-12 (helper script run)
- Command: `./scripts/run_live_edge_assisted_hvac.sh`
- Result: baseline fallback executed; 3 passed, 2 skipped
- Notes: script correctly reported missing edge env vars and performed baseline live smoke only.

- Date: 2026-07-12 (helper script rerun after v2 OTA extraction)
- Command: `./scripts/run_live_edge_assisted_hvac.sh`
- Result: baseline fallback executed; 3 passed, 2 skipped
- Notes: unchanged behavior confirms live baseline checks remain stable after OTA router extraction.

- Date: 2026-07-12 (helper script rerun after v2 mobile websocket extraction)
- Command: `./scripts/run_live_edge_assisted_hvac.sh`
- Result: baseline fallback executed; 3 passed, 2 skipped
- Notes: unchanged behavior confirms live baseline checks remain stable after websocket extraction.

- Date: 2026-07-12 (helper script rerun after setpoint-listener extraction)
- Command: `./scripts/run_live_edge_assisted_hvac.sh`
- Result: baseline fallback executed; 3 passed, 2 skipped
- Notes: unchanged behavior confirms live baseline checks remain stable after listener modularization.

- Date: 2026-07-12 (helper script rerun after realtime websocket increment)
- Command: `./scripts/run_live_edge_assisted_hvac.sh`
- Result: baseline fallback executed; 3 passed, 2 skipped
- Notes: unchanged behavior confirms live baseline checks remain stable after `/api/v2/ws` addition.

- Date: 2026-07-12 (helper script rerun after realtime fan-out foundation)
- Command: `./scripts/run_live_edge_assisted_hvac.sh`
- Result: baseline fallback executed; 3 passed, 2 skipped
- Notes: unchanged behavior confirms live baseline checks remain stable after topic-hub fan-out hooks.

- Date: 2026-07-12 (helper script rerun after realtime scoped fan-out + irrigation skeleton)
- Command: `./scripts/run_live_edge_assisted_hvac.sh`
- Result: baseline fallback executed; 3 passed, 2 skipped
- Notes: unchanged behavior confirms live baseline checks remain stable after scoped realtime filtering and irrigation backend foundation changes.

- Date: 2026-07-12 (helper script rerun after 1+2+3 increment)
- Command: `./scripts/run_live_edge_assisted_hvac.sh`
- Result: baseline fallback executed; 3 passed, 2 skipped
- Notes: unchanged behavior confirms live baseline checks remain stable after notification read-state fan-out, irrigation schedules/runs foundation, and MQTT topic normalization.
