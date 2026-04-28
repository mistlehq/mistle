# Data Plane API Config Module

Selected service config:

- `data-plane-api`

## Config Keys

| Key                           | Type                  | Description                                                             | Default   | Env                                               |
| ----------------------------- | --------------------- | ----------------------------------------------------------------------- | --------- | ------------------------------------------------- |
| `server.host`                 | `string`              | Host/interface for the Data Plane API server bind.                      | None      | `MISTLE_SERVICES_DATA_PLANE_API_HOST`             |
| `server.port`                 | `number` (`1..65535`) | Port for the Data Plane API server bind.                                | None      | `MISTLE_SERVICES_DATA_PLANE_API_PORT` (`Number`)  |
| `database.url`                | `string`              | Runtime Postgres connection URL for data-plane API data.                | None      | `MISTLE_POSTGRES_DATA_PLANE_POOLED_URL`           |
| `database.migrationUrl`       | `string`              | Direct Postgres connection URL used by data-plane API migration jobs.   | None      | `MISTLE_POSTGRES_DATA_PLANE_DIRECT_URL`           |
| `workflow.databaseUrl`        | `string`              | Postgres URL used by OpenWorkflow producer in data-plane.               | None      | `MISTLE_POSTGRES_DATA_PLANE_POOLED_URL`           |
| `workflow.migrationUrl`       | `string`              | Direct Postgres connection URL used by data-plane workflow migrations.  | None      | `MISTLE_POSTGRES_DATA_PLANE_DIRECT_URL`           |
| `workflow.namespaceId`        | `string`              | OpenWorkflow namespace id used when enqueueing runs.                    | None      | `MISTLE_WORKFLOW_DATA_PLANE_NAMESPACE_ID`         |
| `runtimeState.gatewayBaseUrl` | `string`              | Internal gateway base URL used for runtime-state reads.                 | None      | `MISTLE_SERVICES_DATA_PLANE_GATEWAY_INTERNAL_URL` |
| `controlPlaneApi.baseUrl`     | `string`              | Required internal control-plane API base URL used by data-plane API.    | None      | `MISTLE_SERVICES_CONTROL_PLANE_API_INTERNAL_URL`  |
| `sandbox.docker.socketPath`   | `string`              | Docker socket path used for sandbox inspection when provider is Docker. | None      | `MISTLE_SANDBOX_DOCKER_SOCKET_PATH`               |
| `sandbox.e2b.apiKey`          | `string`              | E2B API key used for sandbox inspection when provider is E2B.           | None      | `MISTLE_SANDBOX_E2B_API_KEY`                      |
| `sandbox.e2b.domain`          | `string`              | E2B API domain used for sandbox inspection.                             | `e2b.app` | `MISTLE_SANDBOX_E2B_DOMAIN`                       |
