#!/bin/sh
set -eu

if [ ! -d "/usr/share/nginx/html" ]; then
  echo "Expected dashboard build artifacts in /usr/share/nginx/html." >&2
  exit 1
fi

require_env() {
  variable_name="$1"
  eval "value=\${$variable_name-}"

  if [ -z "${value}" ]; then
    echo "Missing required environment variable: ${variable_name}" >&2
    exit 1
  fi
}

escape_js_string() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

require_boolean() {
  variable_name="$1"
  eval "value=\${$variable_name-}"

  case "${value}" in
    true|false)
      ;;
    *)
      echo "${variable_name} must be either 'true' or 'false'." >&2
      exit 1
      ;;
  esac
}

require_absolute_http_url() {
  variable_name="$1"
  eval "value=\${$variable_name-}"

  if ! printf '%s' "${value}" | grep -Eq '^https?://[^[:space:]/?#]+([/?#].*)?$'; then
    echo "${variable_name} must be a valid absolute URL origin." >&2
    exit 1
  fi
}

require_env "MISTLE_DASHBOARD_CONTROL_PLANE_API_ORIGIN"
require_env "MISTLE_DASHBOARD_AUTH_METHOD_GOOGLE"
require_absolute_http_url "MISTLE_DASHBOARD_CONTROL_PLANE_API_ORIGIN"
require_boolean "MISTLE_DASHBOARD_AUTH_METHOD_GOOGLE"

escaped_control_plane_api_origin=$(escape_js_string "${MISTLE_DASHBOARD_CONTROL_PLANE_API_ORIGIN}")

cat <<EOF >/usr/share/nginx/html/runtime-config.js
window.__MISTLE_RUNTIME_CONFIG__ = {
  controlPlaneApiOrigin: "${escaped_control_plane_api_origin}",
  authMethodGoogle: '${MISTLE_DASHBOARD_AUTH_METHOD_GOOGLE}',
};
EOF

exec nginx -g 'daemon off;'
