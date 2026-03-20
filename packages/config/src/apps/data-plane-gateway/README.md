# Data Plane Gateway config module

Namespace:

- `apps.data_plane_gateway`

Values:

| Key                             | Type                   | Description                                                   | Default | TOML path                                                   | ENV var                                                          |
| ------------------------------- | ---------------------- | ------------------------------------------------------------- | ------- | ----------------------------------------------------------- | ---------------------------------------------------------------- |
| `server.host`                   | `string`               | Host/interface for the data-plane gateway bind.               | None    | `[apps.data_plane_gateway.server].host`                     | `MISTLE_APPS_DATA_PLANE_GATEWAY_HOST`                            |
| `server.port`                   | `number` (`1..65535`)  | Port for the data-plane gateway bind.                         | None    | `[apps.data_plane_gateway.server].port`                     | `MISTLE_APPS_DATA_PLANE_GATEWAY_PORT`                            |
| `database.url`                  | `string`               | Runtime Postgres connection URL for gateway data-plane state. | None    | `[apps.data_plane_gateway.database].url`                    | `MISTLE_APPS_DATA_PLANE_GATEWAY_DATABASE_URL`                    |
| `runtimeState.backend`          | `"memory" \| "valkey"` | Runtime-state backend used by gateway idle/runtime plumbing.  | None    | `[apps.data_plane_gateway.runtime_state].backend`           | `MISTLE_APPS_DATA_PLANE_GATEWAY_RUNTIME_STATE_BACKEND`           |
| `runtimeState.valkey.url`       | `string`               | Valkey connection URL when runtime-state backend is `valkey`. | None    | `[apps.data_plane_gateway.runtime_state.valkey].url`        | `MISTLE_APPS_DATA_PLANE_GATEWAY_RUNTIME_STATE_VALKEY_URL`        |
| `runtimeState.valkey.keyPrefix` | `string`               | Key prefix used for gateway runtime-state records in Valkey.  | None    | `[apps.data_plane_gateway.runtime_state.valkey].key_prefix` | `MISTLE_APPS_DATA_PLANE_GATEWAY_RUNTIME_STATE_VALKEY_KEY_PREFIX` |
| `dataPlaneApi.baseUrl`          | `string`               | Internal base URL for gateway calls into `data-plane-api`.    | None    | `[apps.data_plane_gateway.data_plane_api].base_url`         | `MISTLE_APPS_DATA_PLANE_GATEWAY_DATA_PLANE_API_BASE_URL`         |
