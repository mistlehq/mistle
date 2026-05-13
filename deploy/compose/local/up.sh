#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPOSITORY_ROOT_PATH="$(cd -- "${SCRIPT_DIR}/../../.." && pwd)"
COMPOSE_PATH="${SCRIPT_DIR}/compose.yaml"
ENV_FILE_PATH="${SCRIPT_DIR}/.env"
ENV_EXAMPLE_PATH="${SCRIPT_DIR}/.env.example"
INSTALLED_VERSION_PATH="${SCRIPT_DIR}/VERSION"
REPOSITORY_VERSION_PATH="${REPOSITORY_ROOT_PATH}/VERSION"
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

read_env_value() {
  local key="$1"
  awk -F= -v target_key="${key}" '
    /^[[:space:]]*#/ { next }
    $1 == target_key {
      sub(/^[[:space:]]+/, "", $2)
      sub(/[[:space:]]+$/, "", $2)
      print $2
      exit
    }
  ' "${ENV_FILE_PATH}"
}

read_release_version() {
  local version_path=""

  if [[ -f "${INSTALLED_VERSION_PATH}" ]]; then
    version_path="${INSTALLED_VERSION_PATH}"
  elif [[ -f "${REPOSITORY_VERSION_PATH}" ]]; then
    version_path="${REPOSITORY_VERSION_PATH}"
  else
    echo "VERSION file not found. Install deploy/compose/local/VERSION or run from a source checkout." >&2
    exit 1
  fi

  local release_version
  release_version="$(tr -d '[:space:]' <"${version_path}")"

  if [[ -z "${release_version}" ]]; then
    echo "VERSION file is empty: ${version_path}" >&2
    exit 1
  fi

  printf '%s\n' "${release_version}"
}

set_runtime_env_value() {
  local key="$1"
  local value="$2"

  if grep -q "^${key}=" "${RUNTIME_ENV_PATH}"; then
    awk -v target_key="${key}" -v replacement_value="${value}" '
      index($0, target_key "=") == 1 {
        print target_key "=" replacement_value
        next
      }
      {
        print $0
      }
    ' "${RUNTIME_ENV_PATH}" >"${RUNTIME_ENV_PATH}.tmp"
    mv "${RUNTIME_ENV_PATH}.tmp" "${RUNTIME_ENV_PATH}"
  else
    printf '%s=%s\n' "${key}" "${value}" >>"${RUNTIME_ENV_PATH}"
  fi
}

run_compose() {
  MISTLE_LOCAL_ENV_FILE="${RUNTIME_ENV_PATH}" docker compose \
    -f "${COMPOSE_PATH}" \
    --env-file "${RUNTIME_ENV_PATH}" \
    "$@"
}

ensure_object_store_bucket() {
  local bucket_name="$1"

  if [[ -z "${bucket_name}" ]]; then
    echo "MISTLE_OBJECT_STORE_ASSETS_BUCKET_NAME must be set in ${RUNTIME_ENV_PATH}." >&2
    exit 1
  fi

  echo "Ensuring SeaweedFS bucket exists: ${bucket_name}"

  if run_compose exec -T -e BUCKET_NAME="${bucket_name}" seaweedfs sh -lc \
    'printf "s3.bucket.list\nexit\n" | weed shell -master=seaweedfs:9333 | grep -Fq -- "$BUCKET_NAME"'; then
    return
  fi

  run_compose exec -T -e BUCKET_NAME="${bucket_name}" seaweedfs sh -lc \
    'printf "s3.bucket.create -name %s\nexit\n" "$BUCKET_NAME" | weed shell -master=seaweedfs:9333'
}

configured_auth_base_url="$(read_env_value "MISTLE_SERVICES_CONTROL_PLANE_API_PUBLIC_URL")"
runtime_docker_image="$(read_env_value "MISTLE_DOCKER_IMAGE")"
runtime_sandbox_base_image="$(read_env_value "MISTLE_SANDBOX_DEFAULT_BASE_IMAGE")"

if [[ -z "${runtime_docker_image}" || -z "${runtime_sandbox_base_image}" ]]; then
  release_version="$(read_release_version)"

  if [[ -z "${runtime_docker_image}" ]]; then
    runtime_docker_image="ghcr.io/mistlehq/mistle:docker-v${release_version}"
  fi

  if [[ -z "${runtime_sandbox_base_image}" ]]; then
    runtime_sandbox_base_image="ghcr.io/mistlehq/sandbox-base:v${release_version}"
  fi
fi

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
    "http://host.docker.internal:5100" >/dev/null

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
set_runtime_env_value "MISTLE_SERVICES_CONTROL_PLANE_API_PUBLIC_URL" "${runtime_auth_base_url}"
set_runtime_env_value "MISTLE_DOCKER_IMAGE" "${runtime_docker_image}"
set_runtime_env_value "MISTLE_SANDBOX_DEFAULT_BASE_IMAGE" "${runtime_sandbox_base_image}"

echo "Starting local infrastructure..."
run_compose up -d --wait postgres valkey seaweedfs mailpit
ensure_object_store_bucket "$(read_env_value "MISTLE_OBJECT_STORE_ASSETS_BUCKET_NAME")"

echo "Starting Mistle..."
run_compose up -d mistle

echo "Active callback base URL: ${runtime_auth_base_url}"
echo "Mistle image: ${runtime_docker_image}"
echo "Sandbox base image: ${runtime_sandbox_base_image}"
echo "Dashboard: http://localhost:3000"
echo "Control Plane API: http://localhost:5100"
echo "Data Plane Gateway: http://localhost:5202"
echo "Mailpit UI: http://localhost:8025"
