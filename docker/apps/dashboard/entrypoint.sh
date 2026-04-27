#!/bin/sh
set -eu

if [ ! -d "/usr/share/nginx/html" ]; then
  echo "Expected dashboard build artifacts in /usr/share/nginx/html." >&2
  exit 1
fi

exec nginx -g 'daemon off;'
