#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_PATH="${SCRIPT_DIR}/compose.yaml"
ENV_FILE_PATH="${SCRIPT_DIR}/.env"
ENV_EXAMPLE_PATH="${SCRIPT_DIR}/.env.example"
GENERATED_DIRECTORY_PATH="${SCRIPT_DIR}/.generated"
RUNTIME_ENV_PATH="${GENERATED_DIRECTORY_PATH}/runtime.env"
CLOUDFLARED_LOG_PATH="${GENERATED_DIRECTORY_PATH}/cloudflared.log"
CLOUDFLARED_CONTAINER_NAME_PATH="${GENERATED_DIRECTORY_PATH}/cloudflared.container-name"
CLOUDFLARED_IMAGE_REFERENCE="${CLOUDFLARED_IMAGE_REFERENCE:-cloudflare/cloudflared:latest}"

cleanup_on_failure() {
  cleanup_existing_tunnel
}

cleanup_existing_tunnel() {
  if [[ -f "${CLOUDFLARED_CONTAINER_NAME_PATH}" ]]; then
    local cloudflared_container_name
    cloudflared_container_name="$(cat "${CLOUDFLARED_CONTAINER_NAME_PATH}")"
    if [[ -n "${cloudflared_container_name}" ]]; then
      docker rm -f "${cloudflared_container_name}" >/dev/null 2>&1 || true
    fi
  fi
  rm -f "${CLOUDFLARED_CONTAINER_NAME_PATH}" "${CLOUDFLARED_LOG_PATH}"
}

trap cleanup_on_failure ERR

if [[ ! -f "${ENV_FILE_PATH}" ]]; then
  cp "${ENV_EXAMPLE_PATH}" "${ENV_FILE_PATH}"
  echo "Created ${ENV_FILE_PATH} from .env.example"
fi

mkdir -p "${GENERATED_DIRECTORY_PATH}"

configured_auth_base_url="$(
  awk -F= '
    /^[[:space:]]*#/ { next }
    $1 == "MISTLE_APPS_CONTROL_PLANE_API_AUTH_BASE_URL" {
      sub(/^[[:space:]]+/, "", $2)
      sub(/[[:space:]]+$/, "", $2)
      print $2
      exit
    }
  ' "${ENV_FILE_PATH}"
)"

runtime_auth_base_url="${configured_auth_base_url}"

if [[ -z "${runtime_auth_base_url}" ]]; then
  cleanup_existing_tunnel
  touch "${CLOUDFLARED_LOG_PATH}"

  cloudflared_container_name="mistle-local-cloudflared-$(date +%s)"
  echo "${cloudflared_container_name}" >"${CLOUDFLARED_CONTAINER_NAME_PATH}"
  docker run \
    --name "${cloudflared_container_name}" \
    --detach \
    --add-host host.docker.internal:host-gateway \
    "${CLOUDFLARED_IMAGE_REFERENCE}" \
    tunnel \
    --url \
    "http://host.docker.internal:8080" >/dev/null

  docker logs -f "${cloudflared_container_name}" >"${CLOUDFLARED_LOG_PATH}" 2>&1 &
  cloudflared_logs_pid="$!"

  attempts=0
  while [[ "${attempts}" -lt 60 ]]; do
    if ! docker ps --format '{{.Names}}' | grep -Fxq "${cloudflared_container_name}"; then
      kill "${cloudflared_logs_pid}" 2>/dev/null || true
      wait "${cloudflared_logs_pid}" 2>/dev/null || true
      echo "cloudflared quick tunnel container exited before publishing a public URL." >&2
      cat "${CLOUDFLARED_LOG_PATH}" >&2 || true
      exit 1
    fi

    runtime_auth_base_url="$(
      grep -Eo 'https://[-a-zA-Z0-9]+\.trycloudflare\.com' "${CLOUDFLARED_LOG_PATH}" | head -n 1 || true
    )"

    if [[ -n "${runtime_auth_base_url}" ]]; then
      break
    fi

    sleep 1
    attempts="$((attempts + 1))"
  done

  if [[ -z "${runtime_auth_base_url}" ]]; then
    kill "${cloudflared_logs_pid}" 2>/dev/null || true
    wait "${cloudflared_logs_pid}" 2>/dev/null || true
    echo "Timed out waiting for cloudflared quick tunnel URL." >&2
    cat "${CLOUDFLARED_LOG_PATH}" >&2 || true
    exit 1
  fi

  kill "${cloudflared_logs_pid}" 2>/dev/null || true
  wait "${cloudflared_logs_pid}" 2>/dev/null || true
  echo "Started ephemeral callback tunnel: ${runtime_auth_base_url}"
else
  cleanup_existing_tunnel
  echo "Using configured callback base URL: ${runtime_auth_base_url}"
fi

cp "${ENV_FILE_PATH}" "${RUNTIME_ENV_PATH}"
if grep -q '^MISTLE_APPS_CONTROL_PLANE_API_AUTH_BASE_URL=' "${RUNTIME_ENV_PATH}"; then
  awk -v auth_base_url="${runtime_auth_base_url}" '
    BEGIN {
      replaced = 0
    }
    /^MISTLE_APPS_CONTROL_PLANE_API_AUTH_BASE_URL=/ {
      print "MISTLE_APPS_CONTROL_PLANE_API_AUTH_BASE_URL=" auth_base_url
      replaced = 1
      next
    }
    {
      print $0
    }
    END {
      if (replaced == 0) {
        print "MISTLE_APPS_CONTROL_PLANE_API_AUTH_BASE_URL=" auth_base_url
      }
    }
  ' "${RUNTIME_ENV_PATH}" >"${RUNTIME_ENV_PATH}.tmp"
  mv "${RUNTIME_ENV_PATH}.tmp" "${RUNTIME_ENV_PATH}"
else
  printf '\nMISTLE_APPS_CONTROL_PLANE_API_AUTH_BASE_URL=%s\n' "${runtime_auth_base_url}" >>"${RUNTIME_ENV_PATH}"
fi

echo "Starting local Compose stack..."
MISTLE_LOCAL_ENV_FILE="${RUNTIME_ENV_PATH}" docker compose \
  -f "${COMPOSE_PATH}" \
  --env-file "${RUNTIME_ENV_PATH}" \
  up -d --build

echo "Active callback base URL: ${runtime_auth_base_url}"
echo "Dashboard: http://localhost:3000"
echo "Control Plane API: http://localhost:8080"
echo "Data Plane Gateway: http://localhost:8084"
echo "Mailpit UI: http://localhost:8025"
