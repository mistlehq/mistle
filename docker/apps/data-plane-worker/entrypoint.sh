#!/bin/sh
set -eu

if [ -z "${MISTLE_CONFIG_PATH:-}" ]; then
  echo "MISTLE_CONFIG_PATH is required." >&2
  exit 1
fi

if [ ! -f "apps/data-plane/openworkflow.config.ts" ]; then
  echo "Expected apps/data-plane/openworkflow.config.ts in image." >&2
  exit 1
fi

exec pnpm --dir apps/data-plane worker
