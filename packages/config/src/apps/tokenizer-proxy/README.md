# Tokenizer Proxy config module

Namespace:

- `apps.tokenizer_proxy`

Values:

| Key                                   | Type                  | Description                                                      | Default | TOML path                                                       | ENV var                                                              |
| ------------------------------------- | --------------------- | ---------------------------------------------------------------- | ------- | --------------------------------------------------------------- | -------------------------------------------------------------------- |
| `server.host`                         | `string`              | Host/interface for tokenizer-proxy bind.                         | None    | `[apps.tokenizer_proxy.server].host`                            | `MISTLE_APPS_TOKENIZER_PROXY_HOST`                                   |
| `server.port`                         | `number` (`1..65535`) | Port for tokenizer-proxy bind.                                   | None    | `[apps.tokenizer_proxy.server].port`                            | `MISTLE_APPS_TOKENIZER_PROXY_PORT`                                   |
| `controlPlaneApi.baseUrl`             | `string` (URL)        | Base URL for internal control-plane credential resolution calls. | None    | `[apps.tokenizer_proxy.control_plane_api].base_url`             | `MISTLE_APPS_TOKENIZER_PROXY_CONTROL_PLANE_API_BASE_URL`             |
| `credentialResolver.requestTimeoutMs` | `number` (`>=1`)      | Timeout in ms for calling control-plane credential resolver API. | None    | `[apps.tokenizer_proxy.credential_resolver].request_timeout_ms` | `MISTLE_APPS_TOKENIZER_PROXY_CREDENTIAL_RESOLVER_REQUEST_TIMEOUT_MS` |
| `cache.maxEntries`                    | `number` (`>=1`)      | Maximum number of resolved credential entries to keep in memory. | None    | `[apps.tokenizer_proxy.cache].max_entries`                      | `MISTLE_APPS_TOKENIZER_PROXY_CACHE_MAX_ENTRIES`                      |
| `cache.defaultTtlSeconds`             | `number` (`>=1`)      | Default cache TTL when resolver output has no explicit expiry.   | None    | `[apps.tokenizer_proxy.cache].default_ttl_seconds`              | `MISTLE_APPS_TOKENIZER_PROXY_CACHE_DEFAULT_TTL_SECONDS`              |
| `cache.refreshSkewSeconds`            | `number` (`>=0`)      | Early refresh skew applied before cached credential expiry.      | None    | `[apps.tokenizer_proxy.cache].refresh_skew_seconds`             | `MISTLE_APPS_TOKENIZER_PROXY_CACHE_REFRESH_SKEW_SECONDS`             |
