# Global Config Module

Namespace in final config:

- `global`

## Config Keys

| Key                           | Type                            | Description                                               | Default | TOML                                     | Env                                           |
| ----------------------------- | ------------------------------- | --------------------------------------------------------- | ------- | ---------------------------------------- | --------------------------------------------- |
| `env`                         | `"development" \| "production"` | Application runtime environment mode.                     | None    | `[global].env`                           | `NODE_ENV`                                    |
| `internalAuth.serviceToken`   | `string`                        | Shared internal service auth token across apps.           | None    | `[global.internal_auth].service_token`   | `MISTLE_GLOBAL_INTERNAL_AUTH_SERVICE_TOKEN`   |
| `tunnel.bootstrapTokenSecret` | `string`                        | Shared signing secret for sandbox bootstrap JWT.          | None    | `[global.tunnel].bootstrap_token_secret` | `MISTLE_GLOBAL_TUNNEL_BOOTSTRAP_TOKEN_SECRET` |
| `tunnel.tokenIssuer`          | `string`                        | Shared JWT issuer used by worker mint + gateway verify.   | None    | `[global.tunnel].token_issuer`           | `MISTLE_GLOBAL_TUNNEL_TOKEN_ISSUER`           |
| `tunnel.tokenAudience`        | `string`                        | Shared JWT audience used by worker mint + gateway verify. | None    | `[global.tunnel].token_audience`         | `MISTLE_GLOBAL_TUNNEL_TOKEN_AUDIENCE`         |

Env behavior:

- If `NODE_ENV` is `"production"`, `env` is `"production"`.
- Any other defined `NODE_ENV` value maps to `"development"`.
- If `NODE_ENV` is unset, this module contributes no env override.
