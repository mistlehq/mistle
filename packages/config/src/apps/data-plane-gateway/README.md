# Data Plane Gateway config module

Selected service config:

- `data-plane-gateway`

Values:

| Key                                 | Type                   | Description                                                   | Default | ENV var                                               |
| ----------------------------------- | ---------------------- | ------------------------------------------------------------- | ------- | ----------------------------------------------------- |
| `server.host`                       | `string`               | Host/interface for the data-plane gateway bind.               | None    | `MISTLE_SERVICES_DATA_PLANE_GATEWAY_HOST`             |
| `server.port`                       | `number` (`1..65535`)  | Port for the data-plane gateway bind.                         | None    | `MISTLE_SERVICES_DATA_PLANE_GATEWAY_PORT`             |
| `database.url`                      | `string`               | Runtime Postgres connection URL for gateway data-plane state. | None    | `MISTLE_POSTGRES_DATA_PLANE_POOLED_URL`               |
| `runtimeState.backend`              | `"memory" \| "valkey"` | Runtime-state backend used by gateway idle/runtime plumbing.  | None    | `MISTLE_KV_DATA_PLANE_BACKEND`                        |
| `runtimeState.valkey.url`           | `string`               | Valkey connection URL when runtime-state backend is `valkey`. | None    | `MISTLE_KV_DATA_PLANE_URL`                            |
| `runtimeState.valkey.keyPrefix`     | `string`               | Key prefix used for gateway runtime-state records in Valkey.  | None    | `MISTLE_KV_DATA_PLANE_KEY_PREFIX`                     |
| `dataPlaneApi.baseUrl`              | `string`               | Internal base URL for gateway calls into `data-plane-api`.    | None    | `MISTLE_SERVICES_DATA_PLANE_API_INTERNAL_URL`         |
| `controlPlaneApi.baseUrl`           | `string`               | Internal base URL for gateway calls into `control-plane-api`. | None    | `MISTLE_SERVICES_CONTROL_PLANE_API_INTERNAL_URL`      |
| `controlPlaneApi.mcp.auth.secret`   | `string`               | Signing secret for Mistle MCP runtime bearer credentials.     | None    | `MISTLE_SERVICES_CONTROL_PLANE_API_MCP_AUTH_SECRET`   |
| `controlPlaneApi.mcp.auth.issuer`   | `string`               | JWT issuer for Mistle MCP runtime bearer credentials.         | None    | `MISTLE_SERVICES_CONTROL_PLANE_API_MCP_AUTH_ISSUER`   |
| `controlPlaneApi.mcp.auth.audience` | `string`               | JWT audience for Mistle MCP runtime bearer credentials.       | None    | `MISTLE_SERVICES_CONTROL_PLANE_API_MCP_AUTH_AUDIENCE` |

`runtimeState.backend = "memory"` is for local and integration-test wiring. Root TOML
configuration projects `kv.data_plane` into the gateway and currently supports `valkey`
for operator/self-hosted deployments.
