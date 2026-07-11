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
