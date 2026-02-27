# Data Plane Gateway config module

Namespace:

- `apps.data_plane_gateway`

Values:

| Key            | Type                  | Description                                                   | Default | TOML path                                | ENV var                                       |
| -------------- | --------------------- | ------------------------------------------------------------- | ------- | ---------------------------------------- | --------------------------------------------- |
| `server.host`  | `string`              | Host/interface for the data-plane gateway bind.               | None    | `[apps.data_plane_gateway.server].host`  | `MISTLE_APPS_DATA_PLANE_GATEWAY_HOST`         |
| `server.port`  | `number` (`1..65535`) | Port for the data-plane gateway bind.                         | None    | `[apps.data_plane_gateway.server].port`  | `MISTLE_APPS_DATA_PLANE_GATEWAY_PORT`         |
| `database.url` | `string`              | Runtime Postgres connection URL for gateway data-plane state. | None    | `[apps.data_plane_gateway.database].url` | `MISTLE_APPS_DATA_PLANE_GATEWAY_DATABASE_URL` |
