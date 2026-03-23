#!/bin/sh
set -eu

if [ ! -f "apps/tokenizer-proxy/dist/index.js" ]; then
  echo "Expected prebuilt apps/tokenizer-proxy/dist artifacts in image." >&2
  exit 1
fi

exec node apps/tokenizer-proxy/dist/index.js
