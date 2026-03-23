#!/bin/sh
set -eu

if [ ! -f "apps/data-plane-api/dist/index.js" ]; then
  echo "Expected prebuilt apps/data-plane-api/dist artifacts in image." >&2
  exit 1
fi

node apps/data-plane-api/dist/scripts/run-data-plane-migrations.js
node apps/data-plane-api/dist/scripts/run-data-plane-workflow-migrations.js

exec node apps/data-plane-api/dist/index.js
