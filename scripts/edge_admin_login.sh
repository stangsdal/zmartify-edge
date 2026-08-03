#!/usr/bin/env bash
set -euo pipefail

# Use: source scripts/edge_admin_login.sh
# This script prompts for admin credentials, fetches an Edge bearer token,
# and exports LIVE_EDGE_BASE_URL and LIVE_EDGE_BEARER_TOKEN in the current shell.

DEFAULT_BASE_URL="https://pilot.zmartify.dk"
BASE_URL="${LIVE_EDGE_BASE_URL:-$DEFAULT_BASE_URL}"

if [[ "${1:-}" == "--base-url" ]]; then
  if [[ -z "${2:-}" ]]; then
    echo "Missing value for --base-url" >&2
    return 2 2>/dev/null || exit 2
  fi
  BASE_URL="$2"
fi

if [[ "${1:-}" == "--help" ]]; then
  cat <<'EOF'
Usage:
  source scripts/edge_admin_login.sh
  source scripts/edge_admin_login.sh --base-url https://pilot.zmartify.dk

Prompts for:
  - admin username
  - admin password

Exports:
  - LIVE_EDGE_BASE_URL
  - LIVE_EDGE_BEARER_TOKEN

Optional:
  - LIVE_EDGE_DEVICE_ID can be set manually after login.
EOF
  return 0 2>/dev/null || exit 0
fi

# Detect whether script is sourced (works in bash and zsh with nounset enabled).
if ! (return 0 2>/dev/null); then
  echo "Run this script with source so exports persist:" >&2
  echo "  source scripts/edge_admin_login.sh" >&2
  exit 1
fi

printf "Edge base URL [%s]: " "$BASE_URL"
read -r maybe_base
if [[ -n "${maybe_base:-}" ]]; then
  BASE_URL="$maybe_base"
fi

printf "Admin username: "
read -r ADMIN_USERNAME
if [[ -z "${ADMIN_USERNAME:-}" ]]; then
  echo "Username cannot be empty." >&2
  return 1
fi

printf "Admin password: "
read -rs ADMIN_PASSWORD
echo
if [[ -z "${ADMIN_PASSWORD:-}" ]]; then
  echo "Password cannot be empty." >&2
  return 1
fi

payload_file="$(mktemp)"
resp_file="$(mktemp)"
cleanup() {
  rm -f "$payload_file" "$resp_file"
}

python3 - "$ADMIN_USERNAME" "$ADMIN_PASSWORD" <<'PY' > "$payload_file"
import json, sys
print(json.dumps({
  "username": sys.argv[1],
  "password": sys.argv[2],
}))
PY

http_code="$({
  curl -sS -o "$resp_file" -w "%{http_code}" \
    -H "Content-Type: application/json" \
    -X POST "$BASE_URL/auth/login" \
    --data-binary @"$payload_file"
} || true)"

if [[ "$http_code" != "200" ]]; then
  echo "Login failed (HTTP $http_code)." >&2
  cat "$resp_file" >&2 || true
  cleanup
  return 1
fi

if command -v jq >/dev/null 2>&1; then
  EDGE_TOKEN="$(jq -r '.access_token // empty' "$resp_file")"
  EXPIRES_AT="$(jq -r '.expires_at // empty' "$resp_file")"
else
  EDGE_TOKEN="$(python3 - <<'PY' "$resp_file"
import json, sys
with open(sys.argv[1], 'r', encoding='utf-8') as f:
    data = json.load(f)
print(data.get('access_token', ''))
PY
)"
  EXPIRES_AT="$(python3 - <<'PY' "$resp_file"
import json, sys
with open(sys.argv[1], 'r', encoding='utf-8') as f:
    data = json.load(f)
print(data.get('expires_at', ''))
PY
)"
fi

if [[ -z "$EDGE_TOKEN" ]]; then
  echo "Login succeeded but no access_token was returned." >&2
  cat "$resp_file" >&2 || true
  cleanup
  return 1
fi

export LIVE_EDGE_BASE_URL="$BASE_URL"
export LIVE_EDGE_BEARER_TOKEN="$EDGE_TOKEN"

echo "Token exported to LIVE_EDGE_BEARER_TOKEN"
if [[ -n "$EXPIRES_AT" ]]; then
  echo "Token expires at: $EXPIRES_AT"
fi
echo "Token length: ${#LIVE_EDGE_BEARER_TOKEN}"

# Optional quick sanity check.
me_code="$({
  curl -sS -o /tmp/edge_me_after_login.json -w "%{http_code}" \
    -H "Authorization: Bearer $LIVE_EDGE_BEARER_TOKEN" \
    "$LIVE_EDGE_BASE_URL/auth/me"
} || true)"

if [[ "$me_code" == "200" ]]; then
  echo "Auth check passed (/auth/me = 200)."
else
  echo "Auth check failed (/auth/me = $me_code)." >&2
  cat /tmp/edge_me_after_login.json >&2 || true
  cleanup
  return 1
fi

cleanup
