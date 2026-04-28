# Global Config Module

Namespace in final config:

- `global`

## Config Keys

| Key                                           | Type                            | Description                                                              | Default | Env                                                           |
| --------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------ | ------- | ------------------------------------------------------------- |
| `env`                                         | `"development" \| "production"` | Application runtime environment mode.                                    | None    | `NODE_ENV`                                                    |
| `telemetry.enabled`                           | `boolean`                       | Enables OpenTelemetry export for instrumented apps.                      | None    | `MISTLE_GLOBAL_TELEMETRY_ENABLED`                             |
| `telemetry.debug`                             | `boolean`                       | Enables OpenTelemetry SDK debug diagnostics.                             | None    | `MISTLE_GLOBAL_TELEMETRY_DEBUG`                               |
| `telemetry.traces.endpoint`                   | `string`                        | OTLP HTTP traces endpoint (for example `/v1/traces`).                    | None    | `MISTLE_GLOBAL_TELEMETRY_TRACES_ENDPOINT`                     |
| `telemetry.logs.endpoint`                     | `string`                        | OTLP HTTP logs endpoint (for example `/v1/logs`).                        | None    | `MISTLE_GLOBAL_TELEMETRY_LOGS_ENDPOINT`                       |
| `telemetry.metrics.endpoint`                  | `string`                        | OTLP HTTP metrics endpoint (for example `/v1/metrics`).                  | None    | `MISTLE_GLOBAL_TELEMETRY_METRICS_ENDPOINT`                    |
| `telemetry.resourceAttributes`                | `string`                        | Optional OTEL resource attributes string.                                | None    | `MISTLE_GLOBAL_TELEMETRY_RESOURCE_ATTRIBUTES`                 |
| `internalAuth.serviceToken`                   | `string`                        | Shared internal service auth token across apps.                          | None    | `MISTLE_GLOBAL_INTERNAL_AUTH_SERVICE_TOKEN`                   |
| `sandbox.provider`                            | `"docker" \| "e2b"`             | Sandbox provider used by API, worker, and provisioning flow.             | None    | `MISTLE_GLOBAL_SANDBOX_PROVIDER`                              |
| `sandbox.storage.backend`                     | `"archil" \| "docker_volume"`   | Durable storage backend configured for sandbox persistence.              | None    | `MISTLE_GLOBAL_SANDBOX_STORAGE_BACKEND`                       |
| `sandbox.defaultBaseImage`                    | `string`                        | Shared canonical OCI base image used when starting sandboxes.            | None    | `MISTLE_GLOBAL_SANDBOX_DEFAULT_BASE_IMAGE`                    |
| `sandbox.gatewayWsUrl`                        | `string`                        | Public gateway WebSocket base URL exposed to clients.                    | None    | `MISTLE_GLOBAL_SANDBOX_GATEWAY_WS_URL`                        |
| `sandbox.internalGatewayWsUrl`                | `string`                        | Internal gateway WebSocket base URL used by sandbox runtime.             | None    | `MISTLE_GLOBAL_SANDBOX_INTERNAL_GATEWAY_WS_URL`               |
| `sandbox.bootstrap.tokenSecret`               | `string`                        | Shared signing secret for sandbox bootstrap JWT.                         | None    | `MISTLE_GLOBAL_SANDBOX_BOOTSTRAP_TOKEN_SECRET`                |
| `sandbox.bootstrap.tokenIssuer`               | `string`                        | Shared JWT issuer used by worker mint + gateway verify.                  | None    | `MISTLE_GLOBAL_SANDBOX_BOOTSTRAP_TOKEN_ISSUER`                |
| `sandbox.bootstrap.tokenAudience`             | `string`                        | Shared JWT audience used by worker mint + gateway verify.                | None    | `MISTLE_GLOBAL_SANDBOX_BOOTSTRAP_TOKEN_AUDIENCE`              |
| `sandbox.connect.tokenSecret`                 | `string`                        | Shared signing secret for gateway connection JWTs.                       | None    | `MISTLE_GLOBAL_SANDBOX_CONNECT_TOKEN_SECRET`                  |
| `sandbox.connect.tokenIssuer`                 | `string`                        | JWT issuer used by control-plane connection token minting.               | None    | `MISTLE_GLOBAL_SANDBOX_CONNECT_TOKEN_ISSUER`                  |
| `sandbox.connect.tokenAudience`               | `string`                        | JWT audience expected by gateway connection token verify.                | None    | `MISTLE_GLOBAL_SANDBOX_CONNECT_TOKEN_AUDIENCE`                |
| `sandbox.egress.tokenSecret`                  | `string`                        | Shared signing secret for sandbox egress route grants.                   | None    | `MISTLE_GLOBAL_SANDBOX_EGRESS_TOKEN_SECRET`                   |
| `sandbox.egress.tokenIssuer`                  | `string`                        | JWT issuer used by worker minting for egress grants.                     | None    | `MISTLE_GLOBAL_SANDBOX_EGRESS_TOKEN_ISSUER`                   |
| `sandbox.egress.tokenAudience`                | `string`                        | JWT audience expected by tokenizer-proxy egress verification.            | None    | `MISTLE_GLOBAL_SANDBOX_EGRESS_TOKEN_AUDIENCE`                 |
| `sandbox.publish.baseDomain`                  | `string`                        | Base domain used for published sandbox ports.                            | None    | `MISTLE_GLOBAL_SANDBOX_PUBLISH_BASE_DOMAIN`                   |
| `sandbox.publish.access.tokenSecret`          | `string`                        | Shared signing secret for publish access tokens.                         | None    | `MISTLE_GLOBAL_SANDBOX_PUBLISH_ACCESS_TOKEN_SECRET`           |
| `sandbox.publish.access.tokenIssuer`          | `string`                        | JWT issuer used by control-plane publish access token minting.           | None    | `MISTLE_GLOBAL_SANDBOX_PUBLISH_ACCESS_TOKEN_ISSUER`           |
| `sandbox.publish.access.tokenAudience`        | `string`                        | JWT audience expected by data-plane gateway publish access verification. | None    | `MISTLE_GLOBAL_SANDBOX_PUBLISH_ACCESS_TOKEN_AUDIENCE`         |
| `sandbox.publish.session.cookieSigningSecret` | `string`                        | Cookie signing secret for published sandbox sessions.                    | None    | `MISTLE_GLOBAL_SANDBOX_PUBLISH_SESSION_COOKIE_SIGNING_SECRET` |

Env behavior:

- If `NODE_ENV` is `"production"`, `env` is `"production"`.
- Any other defined `NODE_ENV` value maps to `"development"`.
- If `NODE_ENV` is unset, this module contributes no env override.
