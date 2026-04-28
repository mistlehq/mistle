# Data Plane Gateway config module

Selected service config:

- `data-plane-gateway`

Values:

| Key                             | Type                   | Description                                                   | Default | ENV var                                                          |
| ------------------------------- | ---------------------- | ------------------------------------------------------------- | ------- | ---------------------------------------------------------------- |
| `server.host`                   | `string`               | Host/interface for the data-plane gateway bind.               | None    | `MISTLE_APPS_DATA_PLANE_GATEWAY_HOST`                            |
| `server.port`                   | `number` (`1..65535`)  | Port for the data-plane gateway bind.                         | None    | `MISTLE_APPS_DATA_PLANE_GATEWAY_PORT`                            |
| `database.url`                  | `string`               | Runtime Postgres connection URL for gateway data-plane state. | None    | `MISTLE_APPS_DATA_PLANE_GATEWAY_DATABASE_URL`                    |
| `runtimeState.backend`          | `"memory" \| "valkey"` | Runtime-state backend used by gateway idle/runtime plumbing.  | None    | `MISTLE_APPS_DATA_PLANE_GATEWAY_RUNTIME_STATE_BACKEND`           |
| `runtimeState.valkey.url`       | `string`               | Valkey connection URL when runtime-state backend is `valkey`. | None    | `MISTLE_APPS_DATA_PLANE_GATEWAY_RUNTIME_STATE_VALKEY_URL`        |
| `runtimeState.valkey.keyPrefix` | `string`               | Key prefix used for gateway runtime-state records in Valkey.  | None    | `MISTLE_APPS_DATA_PLANE_GATEWAY_RUNTIME_STATE_VALKEY_KEY_PREFIX` |
| `dataPlaneApi.baseUrl`          | `string`               | Internal base URL for gateway calls into `data-plane-api`.    | None    | `MISTLE_APPS_DATA_PLANE_GATEWAY_DATA_PLANE_API_BASE_URL`         |
| `controlPlaneApi.baseUrl`       | `string`               | Internal base URL for gateway calls into `control-plane-api`. | None    | `MISTLE_APPS_DATA_PLANE_GATEWAY_CONTROL_PLANE_API_BASE_URL`      |

`runtimeState.backend = "memory"` is for local and integration-test wiring. Root TOML
configuration projects `kv.data_plane` into the gateway and currently supports `valkey`
for operator/self-hosted deployments.
