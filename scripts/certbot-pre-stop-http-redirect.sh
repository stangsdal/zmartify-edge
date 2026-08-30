#!/bin/sh
set -eu

EDGE_ROOT=/home/zmartify/zmartify-edge
cd "$EDGE_ROOT"
/usr/bin/docker compose stop http-redirect
