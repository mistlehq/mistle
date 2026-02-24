# Global Config Module

Namespace in final config:

- `global`

## Config Keys

| Key   | Type                            | Description                           | Default | TOML           | Env        |
| ----- | ------------------------------- | ------------------------------------- | ------- | -------------- | ---------- |
| `env` | `"development" \| "production"` | Application runtime environment mode. | None    | `[global].env` | `NODE_ENV` |

Env behavior:

- If `NODE_ENV` is `"production"`, `env` is `"production"`.
- Any other defined `NODE_ENV` value maps to `"development"`.
- If `NODE_ENV` is unset, this module contributes no env override.
