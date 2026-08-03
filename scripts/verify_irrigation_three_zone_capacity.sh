#!/usr/bin/env bash
set -euo pipefail

# Run from an authenticated terminal after sourcing scripts/edge_admin_login.sh.
BASE_URL="${LIVE_EDGE_BASE_URL:-https://pilot.zmartify.dk}"
DEVICE_ID="${LIVE_EDGE_DEVICE_ID:-zmartify-irrigation-01}"
DURATION_SECONDS="${IRRIGATION_TEST_DURATION_SECONDS:-60}"
LOG_FILE="${IRRIGATION_TEST_LOG:-/tmp/irrigation-three-zone-capacity.log}"
test_started=0

exec > >(tee "$LOG_FILE") 2>&1
echo "Live three-zone capacity verifier log: $LOG_FILE"

if [[ -z "${LIVE_EDGE_BEARER_TOKEN:-}" ]]; then
  echo "LIVE_EDGE_BEARER_TOKEN is required. Run: source scripts/edge_admin_login.sh" >&2
  exit 2
fi

api_get() {
  local path="$1"
  local response_file
  local status_code
  response_file=$(mktemp)
  status_code=$(curl -k -sS -o "$response_file" -w '%{http_code}' \
    -H "Authorization: Bearer $LIVE_EDGE_BEARER_TOKEN" "$BASE_URL$path")
  if [[ "$status_code" != 2* ]]; then
    echo "GET $path failed with HTTP $status_code:" >&2
    cat "$response_file" >&2
    rm -f "$response_file"
    return 1
  fi
  cat "$response_file"
  rm -f "$response_file"
}

send_command() {
  local command_type="$1"
  local target_ref="${2:-}"
  local parameters="${3:-}"
  local payload
  local response_file
  local status_code
  if [[ -z "$parameters" ]]; then
    parameters="{}"
  fi
  payload=$(jq -nc --arg command_type "$command_type" --arg target_ref "$target_ref" --argjson parameters "$parameters" \
    '{command_type: $command_type, target_ref: $target_ref, parameters: $parameters}')
  response_file=$(mktemp)
  status_code=$(curl -k -sS -o "$response_file" -w '%{http_code}' \
    -H "Authorization: Bearer $LIVE_EDGE_BEARER_TOKEN" -H 'Content-Type: application/json' \
    -X POST "$BASE_URL/api/v2/devices/$DEVICE_ID/commands" --data-binary "$payload")
  if [[ "$status_code" != 2* ]]; then
    echo "POST $command_type failed with HTTP $status_code:" >&2
    cat "$response_file" >&2
    rm -f "$response_file"
    return 1
  fi
  cat "$response_file"
  rm -f "$response_file"
}

stop_all() {
  send_command "irrigation.stop_all" "" "{}" >/dev/null || true
}

cleanup() {
  if [[ "$test_started" == "1" ]]; then
    echo "Sending stop-all safety command..."
    stop_all
  fi
}
trap cleanup EXIT INT TERM

outputs=$(api_get "/api/v2/devices/$DEVICE_ID/irrigation/outputs")
active_before=$(jq '[.outputs[] | select(.active and (.is_master_valve | not))] | length' <<<"$outputs")
if [[ "$active_before" != "0" ]]; then
  echo "Refusing test: $active_before irrigation zone(s) are already active." >&2
  exit 3
fi

echo "Starting zones 1, 2, and 3 for $DURATION_SECONDS seconds on $DEVICE_ID."
for zone in 1 2 3; do
  response=$(send_command "irrigation.zone.start" "zone$zone" "{\"duration_seconds\":$DURATION_SECONDS}")
  command_id=$(jq -r '.command_id // empty' <<<"$response")
  if [[ -z "$command_id" ]]; then
    echo "Zone $zone command did not return a command ID." >&2
    exit 4
  fi
  echo "zone$zone command accepted: $command_id"
  test_started=1
done

for attempt in {1..15}; do
  outputs=$(api_get "/api/v2/devices/$DEVICE_ID/irrigation/outputs")
  active_count=$(jq '[.outputs[] | select(.active and (.is_master_valve | not))] | length' <<<"$outputs")
  if [[ "$active_count" -ge 3 ]]; then
    echo "Three-zone capacity confirmed. Active outputs:"
    jq -c '[.outputs[] | select(.active and (.is_master_valve | not)) | {local_ref, name}]' <<<"$outputs"
    break
  fi
  if [[ "$attempt" == "15" ]]; then
    echo "Three-zone capacity was not observed; highest active count was $active_count." >&2
    exit 5
  fi
  sleep 1
done

echo "Stopping all test zones."
stop_all
test_started=0

for attempt in {1..15}; do
  outputs=$(api_get "/api/v2/devices/$DEVICE_ID/irrigation/outputs")
  active_count=$(jq '[.outputs[] | select(.active and (.is_master_valve | not))] | length' <<<"$outputs")
  if [[ "$active_count" == "0" ]]; then
    echo "PASS: all irrigation outputs are inactive."
    exit 0
  fi
  sleep 1
done

echo "Stop-all was sent, but active outputs remain reported." >&2
exit 6