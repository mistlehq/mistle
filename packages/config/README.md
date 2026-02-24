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

## Adding And Managing Config

Use module ownership to keep config changes localized:

- `src/global/*` owns `global.*`
- `src/apps/<app-id>/*` owns `apps.<app_id>.*`

### Add A New Key To An Existing Module

1. Update the module schema in `schema.ts` (source of truth for runtime validation and types).
2. Update `load-toml.ts` with the TOML path and parsing logic for the new key.
3. Update `load-env.ts` with the env mapping and parsing logic for the new key.
4. Update the module `README.md` table (Type, TOML key, Env key, defaults).
5. Update [`../../config/config.sample.toml`](../../config/config.sample.toml) with the production-centric sample value.
6. If development init should populate the key, update `scripts/config/presets/development/*.mjs` defaults and/or generators.
7. Add or update tests:
   - unit tests in `src/**/*test.ts` for parsing/merge/validation behavior
   - integration coverage in `integrations/load-config.test.ts` (and fixture updates if needed)

### Add A New App Module

1. Create `src/apps/<app-id>/` with:
   - `schema.ts`
   - `load-toml.ts`
   - `load-env.ts`
   - `index.ts` (exports the `ConfigModule`)
   - `README.md` (single config table)
2. Register the app in `src/modules.ts`:
   - add `AppIds.<NEW_APP>`
   - add to `appConfigModules`
3. Extend typed load results in `src/loader.ts` so `loadConfig` returns the correct app config type for the new app id.
4. Add the app section in [`../../config/config.sample.toml`](../../config/config.sample.toml).
5. Add module docs link in this README.
6. Add integration test coverage for TOML-only, env-only, and merged precedence cases.

### Quick Validation

Run:

- `pnpm --filter @mistle/config lint`
- `pnpm --filter @mistle/config typecheck`
- `pnpm --filter @mistle/config test:all`
