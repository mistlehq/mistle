#!/bin/sh
set -eu

if [ ! -f "apps/data-plane-api/dist/index.js" ]; then
  echo "Expected prebuilt apps/data-plane-api/dist artifacts in image." >&2
  exit 1
fi

exec node apps/data-plane-api/dist/index.js
