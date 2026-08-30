#!/bin/sh
set -eu

EDGE_ROOT=/home/zmartify/zmartify-edge
cd "$EDGE_ROOT"
/usr/bin/docker compose start http-redirect
