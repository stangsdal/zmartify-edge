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

- Date: 2026-07-12 (helper script rerun after mqtt-v2 command-contract + irrigation realtime/overview increment)
- Command: `./scripts/run_live_edge_assisted_hvac.sh`
- Result: baseline fallback executed; 3 passed, 2 skipped
- Notes: unchanged behavior confirms live baseline checks remain stable after v2 command-payload validation, irrigation run realtime fan-out, and site overview endpoint addition.

- Date: 2026-07-12 (helper script rerun after mqtt-v2 outcome contract increment)
- Command: `./scripts/run_live_edge_assisted_hvac.sh`
- Result: baseline fallback executed; 3 passed, 2 skipped
- Notes: unchanged behavior confirms live baseline checks remain stable after v2 setpoint-outcome contract validation and listener ingest extension.

- Date: 2026-07-12 (helper script rerun after irrigation operations-state increment)
- Command: `./scripts/run_live_edge_assisted_hvac.sh`
- Result: baseline fallback executed; 3 passed, 2 skipped
- Notes: unchanged behavior confirms live baseline checks remain stable after irrigation outputs/hydraulics/power/weather/rain-delay API addition.

- Date: 2026-07-12 (helper script rerun after irrigation status-fanout increment)
- Command: `./scripts/run_live_edge_assisted_hvac.sh`
- Result: baseline fallback executed; 3 passed, 2 skipped
- Notes: unchanged behavior confirms live baseline checks remain stable after irrigation status/alarm realtime fan-out hooks.

- Date: 2026-07-12 (helper script rerun after irrigation overview operations-state expansion)
- Command: `./scripts/run_live_edge_assisted_hvac.sh`
- Result: baseline fallback executed; 3 passed, 2 skipped
- Notes: unchanged behavior confirms live baseline checks remain stable after per-device operations-state summary expansion on site overview API.

- Date: 2026-07-12 (helper script rerun after mqtt-v2 ingest + irrigation realtime UI increment)
- Command: `./scripts/run_live_edge_assisted_hvac.sh`
- Result: baseline fallback executed; 3 passed, 2 skipped
- Notes: unchanged behavior confirms live baseline checks remain stable after dedicated mqtt-v2 ingest routing/service addition and app-shell irrigation realtime topic consumption.

- Date: 2026-07-12 (helper script rerun after irrigation outcome contract + ingest increment)
- Command: `./scripts/run_live_edge_assisted_hvac.sh`
- Result: baseline fallback executed; 3 passed, 2 skipped
- Notes: unchanged behavior confirms live baseline checks remain stable after irrigation outcome schema validation and new mqtt-v2 irrigation outcome ingest endpoint.

- Date: 2026-07-12 (helper script rerun after irrigation alarm drill-down UI increment)
- Command: `./scripts/run_live_edge_assisted_hvac.sh`
- Result: baseline fallback executed; 3 passed, 2 skipped
- Notes: unchanged behavior confirms live baseline checks remain stable after app-shell irrigation alert drill-down and weather status badge additions.

- Date: 2026-07-12 (helper script rerun after irrigation command feedback trace UI increment)
- Command: `./scripts/run_live_edge_assisted_hvac.sh`
- Result: baseline fallback executed; 3 passed, 2 skipped
- Notes: unchanged behavior confirms live baseline checks remain stable after realtime command feedback traces were added to irrigation manual-run UI.

- Date: 2026-07-12 (helper script rerun after irrigation alert-navigation/detail-history increment)
- Command: `./scripts/run_live_edge_assisted_hvac.sh`
- Result: baseline fallback executed; 3 passed, 2 skipped
- Notes: unchanged behavior confirms live baseline checks remain stable after irrigation alert cards were wired into detailed realtime history/status pages.

- Date: 2026-07-12 (helper script rerun after irrigation programs + hydraulics parity increment)
- Command: `./scripts/run_live_edge_assisted_hvac.sh`
- Result: baseline fallback executed; 3 passed, 2 skipped
- Notes: unchanged behavior confirms live baseline checks remain stable after real backend program/schedule data and realtime hydraulics/power parity surfaces were added to the app shell.

- Date: 2026-07-12 (helper script rerun after irrigation program actions increment)
- Command: `./scripts/run_live_edge_assisted_hvac.sh`
- Result: baseline fallback executed; 3 passed, 2 skipped
- Notes: unchanged behavior confirms live baseline checks remain stable after program management actions (create/toggle/schedule/run) were bound to v2 endpoints in the app shell.

- Date: 2026-07-12 (helper script rerun after irrigation outcome taxonomy increment)
- Command: `./scripts/run_live_edge_assisted_hvac.sh`
- Result: baseline fallback executed; 3 passed, 2 skipped
- Notes: unchanged behavior confirms live baseline checks remain stable after typed outcome categories and run/valve side-effects were added to the mqtt-v2 irrigation ingest path.

- Date: 2026-07-12 (helper script rerun after enforce-mode ingest coverage increment)
- Command: `./scripts/run_live_edge_assisted_hvac.sh`
- Result: baseline fallback executed; 3 passed, 2 skipped
- Notes: unchanged behavior confirms live baseline checks remain stable after enforce-mode negative-path tests were added for all mqtt-v2 ingest endpoints.

- Date: 2026-07-12 (helper script rerun after scheduled backup sidecar increment)
- Command: `./scripts/run_live_edge_assisted_hvac.sh`
- Result: baseline fallback executed; 3 passed, 2 skipped
- Notes: unchanged behavior confirms live baseline checks remain stable after the `edge-db-backup` compose sidecar was added; compose config validated including stage-gate merge check.

- Date: 2026-07-12 (production deployment + live v2 loop validation)
- Commands: host deploy of merged `main` (dual topic style, contracts mount, ACL regeneration, mosquitto restart), then `publish_setpoint_command("hvac-gateway-1cdbd47a254c", 1, 16.0)` from the API container.
- Result: `setpoint_command_outcome_received` events logged with source `mqtt_v2_setpoint_outcome`, result `confirmed`, command_id `sp-29b30c570ebc` echoed by firmware v0.2.0; legacy `mqtt_last_setpoint_command` path ran in parallel.
- Notes: first full production validation of the v2 MQTT contract loop (edge -> firmware -> edge). Known follow-up: outcomes are ingested twice because both API containers run the listener.

- Date: 2026-07-12 (listener dedup validation)
- Commands: disabled listener in http service, recreated container, re-published no-op setpoint command.
- Result: exactly one `setpoint_command_outcome_received` per topic source (one `mqtt_v2_setpoint_outcome`, one `mqtt_last_setpoint_command`) — duplication resolved; both sources present as expected in dual mode.
