#!/bin/sh
set -eu

if [ ! -f "apps/control-plane-api/dist/index.js" ]; then
  echo "Expected prebuilt apps/control-plane-api/dist artifacts in image." >&2
  exit 1
fi

node apps/control-plane-api/dist/scripts/run-control-plane-migrations.js
node apps/control-plane-api/dist/scripts/run-control-plane-workflow-migrations.js

exec node apps/control-plane-api/dist/index.js
