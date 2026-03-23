#!/bin/sh
set -eu

if [ ! -f "apps/data-plane-worker/dist/openworkflow.config.js" ]; then
  echo "Expected prebuilt apps/data-plane-worker OpenWorkflow dist artifacts in image." >&2
  exit 1
fi

exec node \
  --import ./apps/data-plane-worker/dist/instrument.js \
  ./apps/data-plane-worker/node_modules/@openworkflow/cli/dist/cli.js \
  worker start \
  --config ./apps/data-plane-worker/dist/openworkflow.config.js
