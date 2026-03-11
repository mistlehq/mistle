#!/bin/sh
set -eu

if [ -z "${MISTLE_CONFIG_PATH:-}" ]; then
  echo "MISTLE_CONFIG_PATH is required." >&2
  exit 1
fi

if [ ! -f "apps/control-plane/dist/src/index.js" ]; then
  echo "Expected prebuilt apps/control-plane/dist artifacts in image." >&2
  exit 1
fi

node apps/control-plane/dist/scripts/run-control-plane-migrations.js
node apps/control-plane/dist/scripts/run-control-plane-workflow-migrations.js

exec node apps/control-plane/dist/src/index.js
