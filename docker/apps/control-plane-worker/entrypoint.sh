#!/bin/sh
set -eu

if [ ! -f "apps/control-plane-worker/dist/openworkflow.config.js" ]; then
  echo "Expected prebuilt apps/control-plane-worker OpenWorkflow dist artifacts in image." >&2
  exit 1
fi

exec node \
  --import ./apps/control-plane-worker/dist/instrument.js \
  ./apps/control-plane-worker/node_modules/@openworkflow/cli/dist/cli.js \
  worker start \
  --config ./apps/control-plane-worker/dist/openworkflow.config.js
