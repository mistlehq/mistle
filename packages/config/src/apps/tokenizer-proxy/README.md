# Tokenizer Proxy config module

Selected service config:

- `tokenizer-proxy`

Values:

| Key                             | Type                  | Description                                                      | Default | ENV var                                                         |
| ------------------------------- | --------------------- | ---------------------------------------------------------------- | ------- | --------------------------------------------------------------- |
| `server.host`                   | `string`              | Host/interface for tokenizer-proxy bind.                         | None    | `MISTLE_APPS_TOKENIZER_PROXY_HOST`                              |
| `server.port`                   | `number` (`1..65535`) | Port for tokenizer-proxy bind.                                   | None    | `MISTLE_APPS_TOKENIZER_PROXY_PORT`                              |
| `controlPlaneApi.baseUrl`       | `string` (URL)        | Base URL for internal control-plane credential resolution calls. | None    | `MISTLE_APPS_TOKENIZER_PROXY_CONTROL_PLANE_API_BASE_URL`        |
| `controlPlaneApi.publicBaseUrl` | `string` (URL)        | Public base URL for control-plane session-link redirects.        | None    | `MISTLE_APPS_TOKENIZER_PROXY_CONTROL_PLANE_API_PUBLIC_BASE_URL` |
