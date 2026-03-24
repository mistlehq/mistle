# Data Plane API Config Module

Namespace in final config:

- `apps.data_plane_api`

## Config Keys

| Key                           | Type                  | Description                                                               | Default | TOML                                                   | Env                                                         |
| ----------------------------- | --------------------- | ------------------------------------------------------------------------- | ------- | ------------------------------------------------------ | ----------------------------------------------------------- |
| `server.host`                 | `string`              | Host/interface for the Data Plane API server bind.                        | None    | `[apps.data_plane_api.server].host`                    | `MISTLE_APPS_DATA_PLANE_API_HOST`                           |
| `server.port`                 | `number` (`1..65535`) | Port for the Data Plane API server bind.                                  | None    | `[apps.data_plane_api.server].port`                    | `MISTLE_APPS_DATA_PLANE_API_PORT` (`Number`)                |
| `database.url`                | `string`              | Runtime Postgres connection URL for data-plane API data.                  | None    | `[apps.data_plane_api.database].url`                   | `MISTLE_APPS_DATA_PLANE_API_DATABASE_URL`                   |
| `database.migrationUrl`       | `string`              | Direct Postgres connection URL used by data-plane API migrations on boot. | None    | `[apps.data_plane_api.database].migration_url`         | `MISTLE_APPS_DATA_PLANE_API_DATABASE_MIGRATION_URL`         |
| `workflow.databaseUrl`        | `string`              | Postgres URL used by OpenWorkflow producer in data-plane.                 | None    | `[apps.data_plane_api.workflow].database_url`          | `MISTLE_APPS_DATA_PLANE_API_WORKFLOW_DATABASE_URL`          |
| `workflow.namespaceId`        | `string`              | OpenWorkflow namespace id used when enqueueing runs.                      | None    | `[apps.data_plane_api.workflow].namespace_id`          | `MISTLE_APPS_DATA_PLANE_API_WORKFLOW_NAMESPACE_ID`          |
| `runtimeState.gatewayBaseUrl` | `string`              | Internal gateway base URL used for runtime-state reads.                   | None    | `[apps.data_plane_api.runtime_state].gateway_base_url` | `MISTLE_APPS_DATA_PLANE_API_RUNTIME_STATE_GATEWAY_BASE_URL` |
