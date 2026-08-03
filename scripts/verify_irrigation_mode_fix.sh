#!/usr/bin/env bash
set -euo pipefail

BASE_URL_DEFAULT="https://pilot.zmartify.dk"
BASE_URL="${LIVE_EDGE_BASE_URL:-$BASE_URL_DEFAULT}"
DEVICE_HINT="${LIVE_EDGE_DEVICE_ID:-}"

if [[ "${1:-}" == "--help" ]]; then
  cat <<'EOF'
Usage:
  bash scripts/verify_irrigation_mode_fix.sh
  bash scripts/verify_irrigation_mode_fix.sh --base-url https://pilot.zmartify.dk
  bash scripts/verify_irrigation_mode_fix.sh --device-id zmartify-irrigation-01

What it does:
  1) Prompts for admin username/password and logs in (/auth/login)
  2) Discovers devices and auto-selects irrigation controller
  3) Sends controller mode auto command
  4) Verifies mode outcome event by command_id
  5) Sends irrigation.zone.start command (zone1)
  6) Verifies start outcome and latest blocked_reason
EOF
  exit 0
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-url)
      BASE_URL="$2"; shift 2 ;;
    --device-id)
      DEVICE_HINT="$2"; shift 2 ;;
    *)
      echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

printf "Edge base URL [%s]: " "$BASE_URL"
read -r maybe_base
if [[ -n "${maybe_base:-}" ]]; then
  BASE_URL="$maybe_base"
fi

printf "Admin username: "
read -r ADMIN_USERNAME
printf "Admin password: "
read -rs ADMIN_PASSWORD
echo

if [[ -z "${ADMIN_USERNAME:-}" || -z "${ADMIN_PASSWORD:-}" ]]; then
  echo "Username/password cannot be empty" >&2
  exit 2
fi

workdir="$(mktemp -d)"
cleanup() { rm -rf "$workdir"; }
trap cleanup EXIT

payload_login="$workdir/login_payload.json"
resp_login="$workdir/login_resp.json"
resp_devices="$workdir/devices.json"
resp_mode="$workdir/mode.json"
resp_start="$workdir/start.json"
resp_events="$workdir/events.json"

python3 - "$ADMIN_USERNAME" "$ADMIN_PASSWORD" <<'PY' > "$payload_login"
import json, sys
print(json.dumps({"username": sys.argv[1], "password": sys.argv[2]}))
PY

code=$(curl -k -sS -o "$resp_login" -w '%{http_code}' \
  -H 'Content-Type: application/json' \
  -X POST "$BASE_URL/auth/login" \
  --data-binary @"$payload_login")

if [[ "$code" != "200" ]]; then
  echo "AUTH_HTTP=$code"
  cat "$resp_login"
  exit 3
fi

TOKEN="$(jq -r '.access_token // empty' "$resp_login")"
if [[ -z "$TOKEN" ]]; then
  echo "No access_token in login response"
  cat "$resp_login"
  exit 4
fi

echo "AUTH_HTTP=200"
echo "TOKEN_LEN=${#TOKEN}"

code=$(curl -k -sS -o "$resp_devices" -w '%{http_code}' \
  -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/api/v2/devices")

if [[ "$code" != "200" ]]; then
  echo "DEVICES_HTTP=$code"
  cat "$resp_devices"
  exit 5
fi

DEVICE_ID_REAL="$(python3 - "$resp_devices" "$DEVICE_HINT" <<'PY'
import json, sys
path, hint = sys.argv[1], (sys.argv[2] or '').strip()
with open(path,'r',encoding='utf-8') as f:
    data=json.load(f)
items=data if isinstance(data,list) else data.get('items',[])
rows=[]
for d in items:
    did=d.get('device_id') or d.get('device_ref') or d.get('id') or d.get('external_id')
    name=(d.get('display_name') or d.get('name') or '').lower()
    local=(d.get('local_url') or d.get('base_url') or '').lower()
    if did:
        rows.append((str(did), name, local))
if hint:
    for did,_,_ in rows:
        if did == hint:
            print(did); raise SystemExit(0)
for did,name,local in rows:
    key=f"{did} {name} {local}"
    if 'irrigation' in key or 'control' in key or '192.168.10.113' in key:
        print(did); raise SystemExit(0)
if rows:
    print(rows[0][0])
PY
)"

if [[ -z "$DEVICE_ID_REAL" ]]; then
  echo "Could not determine a device_id"
  cat "$resp_devices"
  exit 6
fi

echo "DEVICE_ID=$DEVICE_ID_REAL"

echo "MODE_REQUEST"
mode_code=$(curl -k -sS -o "$resp_mode" -w '%{http_code}' \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -X POST "$BASE_URL/api/v2/devices/$DEVICE_ID_REAL/controller/mode" \
  -d '{"mode":"auto"}')
echo "MODE_HTTP=$mode_code"
cat "$resp_mode"
if [[ "$mode_code" != "200" ]]; then
  exit 7
fi
MODE_CID="$(jq -r '.command_id // empty' "$resp_mode")"

echo "MODE_CID=$MODE_CID"

match_outcome_for_cid() {
  local cid="$1"
  local file="$2"
  jq -c --arg cid "$cid" '
    [ .[]
      | select(
          (.payload.command_id? // "") == $cid
          or (.payload.run_id? // "") == $cid
          or (.payload.command.command_id? // "") == $cid
          or (.payload.command.id? // "") == $cid
          or (.payload.id? // "") == $cid
          or (.payload.correlation_id? // "") == $cid
          or (.payload.payload.run_id? // "") == $cid
          or (.payload.payload.command_id? // "") == $cid
      )
      | . + {
          _priority:
            (if .payload.event_type == "command.accepted" then 90
             elif .payload.event_type == "command.duplicate" then 85
             elif .payload.event_type == "command.rejected" then 80
             elif .payload.event_type == "run.rejected" then 70
             elif .payload.event_type == "run.started" then 20
             elif .payload.event_type == "run.completed" then 10
             elif .payload.event_type == "zone.started" then 15
             elif .payload.event_type == "zone.stopped" then 15
             elif .payload.event_type == "config.mode.updated" then 5
             elif .payload.event_type == "config.mode.rejected" then 6
             else 30 end)
        }
    ]
    | sort_by(._priority)
    | (.[0] | del(._priority)) // empty
  ' "$file"
}

match_start_execution_outcome_for_cid() {
  local cid="$1"
  local file="$2"
  jq -c --arg cid "$cid" '
    [ .[]
      | select(
          ((.payload.command_id? // "") == $cid
          or (.payload.run_id? // "") == $cid
          or (.payload.command.command_id? // "") == $cid
          or (.payload.command.id? // "") == $cid
          or (.payload.id? // "") == $cid
          or (.payload.correlation_id? // "") == $cid
          or (.payload.payload.run_id? // "") == $cid
          or (.payload.payload.command_id? // "") == $cid)
          and (
            (.payload.event_type == "run.started")
            or (.payload.event_type == "zone.started")
            or (.payload.event_type == "run.rejected")
            or (.payload.event_type == "run.completed")
            or (.event_type == "irrigation_zone_started")
            or (.event_type == "irrigation_zone_stopped")
          )
      )
      | . + {
          _priority:
            (if .payload.event_type == "run.rejected" then 5
             elif .payload.event_type == "run.started" then 10
             elif .payload.event_type == "zone.started" then 12
             elif .payload.event_type == "run.completed" then 20
             elif .event_type == "irrigation_zone_started" then 30
             elif .event_type == "irrigation_zone_stopped" then 40
             else 99 end)
        }
    ]
    | sort_by(._priority)
    | (.[0] | del(._priority)) // empty
  ' "$file"
}

match_start_ack_for_cid() {
  local cid="$1"
  local file="$2"
  jq -c --arg cid "$cid" '
    [ .[]
      | select(
          ((.payload.command_id? // "") == $cid
          or (.payload.run_id? // "") == $cid
          or (.payload.command.command_id? // "") == $cid
          or (.payload.command.id? // "") == $cid
          or (.payload.id? // "") == $cid
          or (.payload.correlation_id? // "") == $cid
          or (.payload.payload.run_id? // "") == $cid
          or (.payload.payload.command_id? // "") == $cid)
          and (.payload.event_type == "command.accepted")
      )
    ]
    | .[0] // empty
  ' "$file"
}

print_event_diagnostics() {
  local file="$1"
  echo "EVENT_DIAGNOSTICS"
  echo "TOP_EVENT_TYPES"
  jq -r '.[].event_type // empty' "$file" | sort | uniq -c | sort -nr | head -n 12 || true
  echo "RECENT_EVENT_SAMPLE"
  jq -c '.[0:10] | map({event_type: .event_type, payload_keys: ((.payload // {}) | keys), payload_command_id: (.payload.command_id // .payload.command.command_id // .payload.command.id // .payload.id // .payload.correlation_id // ""), payload_run_id: (.payload.run_id // .payload.payload.run_id // "")})' "$file" || true
  echo "STATUS_FEEDBACK_SUMMARY"
  jq -r '
    [ .[]
      | select(.event_type == "irrigation_status_feedback")
      | [(.payload.result // ""), (.payload.detail // ""), (.payload.payload.blocked_reason // "")]
      | @tsv
    ]
    | .[0:25]
    | .[]
  ' "$file" | awk -F'\t' '{k=$1"|"$2"|"$3; c[k]++} END{for (k in c) print c[k], k}' | sort -nr | head -n 12 || true
  echo "LATEST_ZONE_STARTED"
  jq -c 'map(select(.event_type=="irrigation_zone_started")) | .[0] // empty' "$file" || true
  echo "LATEST_ZONE_STOPPED"
  jq -c 'map(select(.event_type=="irrigation_zone_stopped")) | .[0] // empty' "$file" || true
}

mode_out=''
for i in {1..25}; do
  curl -k -sS -H "Authorization: Bearer $TOKEN" \
    "$BASE_URL/api/v2/events/device/$DEVICE_ID_REAL?limit=180" > "$resp_events"
  mode_out=$(match_outcome_for_cid "$MODE_CID" "$resp_events")
  if [[ -n "$mode_out" ]]; then
    echo "MODE_OUTCOME_ITER=$i"
    echo "$mode_out"
    break
  fi
  sleep 2
done
if [[ -z "$mode_out" ]]; then
  echo "MODE_OUTCOME_NOT_FOUND"
  print_event_diagnostics "$resp_events"
fi

echo "START_REQUEST"
start_code=$(curl -k -sS -o "$resp_start" -w '%{http_code}' \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -X POST "$BASE_URL/api/v2/devices/$DEVICE_ID_REAL/commands" \
  -d '{"command_type":"irrigation.zone.start","target_ref":"zone1","parameters":{"duration_seconds":120}}')
echo "START_HTTP=$start_code"
cat "$resp_start"
if [[ "$start_code" != "200" ]]; then
  exit 8
fi
START_CID="$(jq -r '.command_id // empty' "$resp_start")"
echo "START_CID=$START_CID"

start_out=''
start_ack=''
for i in {1..30}; do
  curl -k -sS -H "Authorization: Bearer $TOKEN" \
    "$BASE_URL/api/v2/events/device/$DEVICE_ID_REAL?limit=220" > "$resp_events"
  start_out=$(match_start_execution_outcome_for_cid "$START_CID" "$resp_events")
  if [[ -z "$start_ack" ]]; then
    start_ack=$(match_start_ack_for_cid "$START_CID" "$resp_events")
    if [[ -n "$start_ack" ]]; then
      echo "START_ACK_ITER=$i"
      echo "$start_ack"
    fi
  fi
  latest_blocked=$(jq -r 'map(select(.event_type=="irrigation_status_feedback")) | .[0].payload.blocked_reason // ""' "$resp_events" | tr -d '\r\n')
  if [[ -n "$start_out" ]]; then
    echo "START_OUTCOME_ITER=$i"
    echo "$start_out"
    printf 'LATEST_BLOCKED_REASON=%s\n' "${latest_blocked:-}"
    break
  fi
  sleep 2
done
if [[ -z "$start_out" ]]; then
  if [[ -n "$start_ack" ]]; then
    echo "START_ACK_ONLY"
  fi
  echo "START_OUTCOME_NOT_FOUND"
  print_event_diagnostics "$resp_events"
  printf 'LATEST_BLOCKED_REASON=%s\n' "${latest_blocked:-}"
fi

echo "DONE"
