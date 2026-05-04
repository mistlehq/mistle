#!/bin/sh
set -eu

app_root="/app/node_modules/@mistle/data-plane-worker"

if [ ! -f "${app_root}/dist/openworkflow.config.js" ]; then
  echo "Expected prebuilt @mistle/data-plane-worker OpenWorkflow dist artifacts in image." >&2
  exit 1
fi

cd "${app_root}"
export NODE_OPTIONS="--import=./dist/instrument.js${NODE_OPTIONS:+ ${NODE_OPTIONS}}"

exec ./node_modules/.bin/openworkflow \
  worker start \
  --config ./dist/openworkflow.config.js
