# Tokenizer Proxy config module

Namespace:

- `apps.tokenizer_proxy`

Values:

| Key                                   | Type                  | Description                                                      | Default | TOML path                                                       | ENV var                                                              |
| ------------------------------------- | --------------------- | ---------------------------------------------------------------- | ------- | --------------------------------------------------------------- | -------------------------------------------------------------------- |
| `server.host`                         | `string`              | Host/interface for tokenizer-proxy bind.                         | None    | `[apps.tokenizer_proxy.server].host`                            | `MISTLE_APPS_TOKENIZER_PROXY_HOST`                                   |
| `server.port`                         | `number` (`1..65535`) | Port for tokenizer-proxy bind.                                   | None    | `[apps.tokenizer_proxy.server].port`                            | `MISTLE_APPS_TOKENIZER_PROXY_PORT`                                   |
| `controlPlaneApi.baseUrl`             | `string` (URL)        | Base URL for internal control-plane credential resolution calls. | None    | `[apps.tokenizer_proxy.control_plane_api].base_url`             | `MISTLE_APPS_TOKENIZER_PROXY_CONTROL_PLANE_API_BASE_URL`             |
