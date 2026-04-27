#!/bin/sh
set -eu

if [ ! -f "apps/control-plane-api/dist/index.js" ]; then
  echo "Expected prebuilt apps/control-plane-api/dist artifacts in image." >&2
  exit 1
fi

exec node apps/control-plane-api/dist/index.js
