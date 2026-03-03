#!/bin/sh
set -eu

if [ -z "${MISTLE_CONFIG_PATH:-}" ]; then
  echo "MISTLE_CONFIG_PATH is required." >&2
  exit 1
fi

if [ ! -f "apps/data-plane-worker/dist/index.js" ]; then
  echo "Expected prebuilt apps/data-plane-worker/dist artifacts in image." >&2
  exit 1
fi

exec node apps/data-plane-worker/dist/index.js
