#!/bin/sh
set -eu

if [ ! -f "/app/node_modules/@mistle/data-plane-api/dist/index.js" ]; then
  echo "Expected prebuilt @mistle/data-plane-api dist artifacts in image." >&2
  exit 1
fi

exec node /app/node_modules/@mistle/data-plane-api/dist/index.js
