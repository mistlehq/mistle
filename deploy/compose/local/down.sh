#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_PATH="${SCRIPT_DIR}/compose.yaml"
ENV_FILE_PATH="${SCRIPT_DIR}/.env"
GENERATED_DIRECTORY_PATH="${SCRIPT_DIR}/.generated"
RUNTIME_ENV_PATH="${GENERATED_DIRECTORY_PATH}/runtime.env"
CLOUDFLARED_CONTAINER_NAME_PATH="${GENERATED_DIRECTORY_PATH}/cloudflared.container-name"
CLOUDFLARED_LOG_PATH="${GENERATED_DIRECTORY_PATH}/cloudflared.log"

compose_env_file="${ENV_FILE_PATH}"
if [[ -f "${RUNTIME_ENV_PATH}" ]]; then
  compose_env_file="${RUNTIME_ENV_PATH}"
fi

docker compose \
  -f "${COMPOSE_PATH}" \
  --env-file "${compose_env_file}" \
  down "$@"

if [[ -f "${CLOUDFLARED_CONTAINER_NAME_PATH}" ]]; then
  cloudflared_container_name="$(cat "${CLOUDFLARED_CONTAINER_NAME_PATH}")"
  if [[ -n "${cloudflared_container_name}" ]]; then
    docker rm -f "${cloudflared_container_name}" >/dev/null 2>&1 || true
  fi
fi

rm -f "${CLOUDFLARED_CONTAINER_NAME_PATH}" "${CLOUDFLARED_LOG_PATH}" "${RUNTIME_ENV_PATH}"
