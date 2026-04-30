#!/bin/sh
set -eu

if [ ! -f "/app/node_modules/@mistle/tokenizer-proxy/dist/index.js" ]; then
  echo "Expected prebuilt @mistle/tokenizer-proxy dist artifacts in image." >&2
  exit 1
fi

exec node /app/node_modules/@mistle/tokenizer-proxy/dist/index.js
