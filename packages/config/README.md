# @mistle/config

Central config package for Mistle apps.

`@mistle/config` loads configuration through a two-step pipeline:

1. Load from TOML and env (module-by-module).
2. Merge with env taking precedence over TOML.

Then the merged result is validated by module schemas.

## Public API

The package exports these public APIs from [`src/index.ts`](./src/index.ts):

- `loadConfig(options)`
- `AppIds`

## Usage

```ts
import { AppIds, loadConfig } from "@mistle/config";

const config = loadConfig({
  app: AppIds.CONTROL_PLANE_API,
  configPath: "/absolute/path/to/config.toml",
  env: process.env,
  includeGlobal: true,
});
```

`loadConfig` requires:

- `app`

`configPath` and `env` are both optional individually, but at least one must be provided.
If both are omitted, `loadConfig` throws a clear error.

Currently supported `app` values are exposed in `AppIds`.

`configPath` can come from either `options.configPath` or `options.env.MISTLE_CONFIG_PATH`.
There is no implicit fallback to process env.

`includeGlobal` defaults to `true`.

Return shape:

- with `includeGlobal: true` (default): `{ global, app }`
- with `includeGlobal: false`: `{ app }`

## Merge Rules

- TOML is loaded first.
- Env values are loaded second.
- Env values override TOML when both provide the same key.

## Module Docs

- [Global module](./src/global/README.md)
- [Control Plane API module](./src/apps/control-plane-api/README.md)
