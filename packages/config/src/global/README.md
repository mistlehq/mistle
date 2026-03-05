# Global Config Module

Namespace in final config:

- `global`

## Config Keys

| Key                               | Type                            | Description                                                  | Default | TOML                                        | Env                                              |
| --------------------------------- | ------------------------------- | ------------------------------------------------------------ | ------- | ------------------------------------------- | ------------------------------------------------ |
| `env`                             | `"development" \| "production"` | Application runtime environment mode.                        | None    | `[global].env`                              | `NODE_ENV`                                       |
| `internalAuth.serviceToken`       | `string`                        | Shared internal service auth token across apps.              | None    | `[global.internal_auth].service_token`      | `MISTLE_GLOBAL_INTERNAL_AUTH_SERVICE_TOKEN`      |
| `sandbox.defaultBaseImage`        | `string`                        | Default sandbox base image used when starting new sessions.  | None    | `[global.sandbox].default_base_image`       | `MISTLE_GLOBAL_SANDBOX_DEFAULT_BASE_IMAGE`       |
| `sandbox.gatewayWsUrl`            | `string`                        | Public gateway WebSocket base URL exposed to clients.        | None    | `[global.sandbox].gateway_ws_url`           | `MISTLE_GLOBAL_SANDBOX_GATEWAY_WS_URL`           |
| `sandbox.internalGatewayWsUrl`    | `string`                        | Internal gateway WebSocket base URL used by sandbox runtime. | None    | `[global.sandbox].internal_gateway_ws_url`  | `MISTLE_GLOBAL_SANDBOX_INTERNAL_GATEWAY_WS_URL`  |
| `sandbox.bootstrap.tokenSecret`   | `string`                        | Shared signing secret for sandbox bootstrap JWT.             | None    | `[global.sandbox.bootstrap].token_secret`   | `MISTLE_GLOBAL_SANDBOX_BOOTSTRAP_TOKEN_SECRET`   |
| `sandbox.bootstrap.tokenIssuer`   | `string`                        | Shared JWT issuer used by worker mint + gateway verify.      | None    | `[global.sandbox.bootstrap].token_issuer`   | `MISTLE_GLOBAL_SANDBOX_BOOTSTRAP_TOKEN_ISSUER`   |
| `sandbox.bootstrap.tokenAudience` | `string`                        | Shared JWT audience used by worker mint + gateway verify.    | None    | `[global.sandbox.bootstrap].token_audience` | `MISTLE_GLOBAL_SANDBOX_BOOTSTRAP_TOKEN_AUDIENCE` |
| `sandbox.connect.tokenSecret`     | `string`                        | Shared signing secret for gateway connection JWTs.           | None    | `[global.sandbox.connect].token_secret`     | `MISTLE_GLOBAL_SANDBOX_CONNECT_TOKEN_SECRET`     |
| `sandbox.connect.tokenIssuer`     | `string`                        | JWT issuer used by control-plane connection token minting.   | None    | `[global.sandbox.connect].token_issuer`     | `MISTLE_GLOBAL_SANDBOX_CONNECT_TOKEN_ISSUER`     |
| `sandbox.connect.tokenAudience`   | `string`                        | JWT audience expected by gateway connection token verify.    | None    | `[global.sandbox.connect].token_audience`   | `MISTLE_GLOBAL_SANDBOX_CONNECT_TOKEN_AUDIENCE`   |

Env behavior:

- If `NODE_ENV` is `"production"`, `env` is `"production"`.
- Any other defined `NODE_ENV` value maps to `"development"`.
- If `NODE_ENV` is unset, this module contributes no env override.
