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

read_compose_env_value() {
  local key="$1"
  awk -F= -v target_key="${key}" '
    /^[[:space:]]*#/ { next }
    $1 == target_key {
      value = substr($0, index($0, "=") + 1)
      sub(/^[[:space:]]+/, "", value)
      sub(/[[:space:]]+$/, "", value)
      print value
      exit
    }
  ' "${compose_env_file}"
}

cleanup_sandbox_runtime_containers() {
  local sandbox_network_name sandbox_container_ids

  sandbox_network_name="$(read_compose_env_value "MISTLE_SANDBOX_NETWORK_NAME")"

  if [[ -z "${sandbox_network_name}" ]]; then
    return
  fi

  sandbox_container_ids="$(
    docker ps -aq \
      --filter "label=mistle.sandbox.provider=docker" \
      --filter "network=${sandbox_network_name}"
  )"

  if [[ -z "${sandbox_container_ids}" ]]; then
    return
  fi

  echo "Removing local sandbox runtime containers blocking network teardown..."
  # These runtime containers are spawned outside Compose by the local worker.
  # Force-removing them here lets `down.sh` fully tear down the local stack.
  while IFS= read -r container_id; do
    if [[ -n "${container_id}" ]]; then
      docker rm -f "${container_id}" >/dev/null 2>&1 || true
    fi
  done <<<"${sandbox_container_ids}"
}

compose_down() {
  docker compose \
    -f "${COMPOSE_PATH}" \
    --env-file "${compose_env_file}" \
    down "$@"
}

cleanup_sandbox_runtime_containers
compose_down "$@"

if [[ -f "${CLOUDFLARED_CONTAINER_NAME_PATH}" ]]; then
  cloudflared_container_name="$(cat "${CLOUDFLARED_CONTAINER_NAME_PATH}")"
  if [[ -n "${cloudflared_container_name}" ]]; then
    docker rm -f "${cloudflared_container_name}" >/dev/null 2>&1 || true
  fi
fi

rm -f "${CLOUDFLARED_CONTAINER_NAME_PATH}" "${CLOUDFLARED_LOG_PATH}" "${RUNTIME_ENV_PATH}"
