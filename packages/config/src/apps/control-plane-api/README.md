# Control Plane API Config Module

Namespace in final config:

- `apps.control_plane_api`

## Config Keys

| Key    | Type                  | Description                                                 | Default | TOML                            | Env                                             |
| ------ | --------------------- | ----------------------------------------------------------- | ------- | ------------------------------- | ----------------------------------------------- |
| `host` | `string`              | Host/interface for the Control Plane API server to bind on. | None    | `[apps.control_plane_api].host` | `MISTLE_APPS_CONTROL_PLANE_API_HOST`            |
| `port` | `number` (`1..65535`) | Port for the Control Plane API server to bind on.           | None    | `[apps.control_plane_api].port` | `MISTLE_APPS_CONTROL_PLANE_API_PORT` (`Number`) |
