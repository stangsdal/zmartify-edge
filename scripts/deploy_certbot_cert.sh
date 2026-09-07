#!/bin/sh
set -eu

EDGE_ROOT=/home/zmartify/zmartify-edge
CERT_NAME=app.zmartify.dk
TARGET="$EDGE_ROOT/acme/live/$CERT_NAME"

test -n "${RENEWED_LINEAGE:-}"
install -d -o 1883 -g 1883 -m 0750 "$TARGET"
install -o 1883 -g 1883 -m 0644 "$RENEWED_LINEAGE/fullchain.pem" "$TARGET/fullchain.pem"
install -o 1883 -g 1883 -m 0640 "$RENEWED_LINEAGE/privkey.pem" "$TARGET/privkey.pem"
awk '
	/-----BEGIN CERTIFICATE-----/ { certificate_count++ }
	certificate_count <= 3 { print }
' "$RENEWED_LINEAGE/fullchain.pem" > "$TARGET/mqtt-chain.pem"
chown 1883:1883 "$TARGET/mqtt-chain.pem"
chmod 0644 "$TARGET/mqtt-chain.pem"

cd "$EDGE_ROOT"
/usr/bin/docker compose restart zmartify-edge-api mosquitto
