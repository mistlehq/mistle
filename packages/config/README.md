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
- `convertEnvToTomlRecord(env)`
- `convertTomlToEnvRecord(tomlRoot)`
- `convertDotenvContentToTomlContent(content)`
- `convertTomlContentToDotenvContent(content)`
- `parseDotenvContent(content)`
- `stringifyDotenvContent(env)`

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

`app` is type-safe and inferred from `options.app` (for example, `AppIds.CONTROL_PLANE_API` returns the control-plane-api app config shape).

## Conversion Helpers

`@mistle/config` includes helpers for converting between runtime env and TOML shapes:

- Env record to TOML record:

```ts
import { convertEnvToTomlRecord } from "@mistle/config";

const tomlRoot = convertEnvToTomlRecord(process.env);
```

- TOML record to env record:

```ts
import { convertTomlToEnvRecord } from "@mistle/config";

const env = convertTomlToEnvRecord({
  global: { env: "development" },
});
```

- Dotenv content to TOML content:

```ts
import { convertDotenvContentToTomlContent } from "@mistle/config";

const tomlContent = convertDotenvContentToTomlContent("NODE_ENV=production\n");
```

- TOML content to dotenv content:

```ts
import { convertTomlContentToDotenvContent } from "@mistle/config";

const dotenvContent = convertTomlContentToDotenvContent('[global]\nenv = "production"\n');
```

Scope:

- Conversion covers keys managed by `@mistle/config` modules (`global`, `apps.control_plane_api`, `apps.control_plane_worker`, `apps.data_plane_api`, `apps.data_plane_worker`).
- Unknown keys are ignored.

## Merge Rules

- TOML is loaded first.
- Env values are loaded second.
- Env values override TOML when both provide the same key.

## Module Docs

- [Global module](./src/global/README.md)
- [Control Plane API module](./src/apps/control-plane-api/README.md)
- [Control Plane Worker module](./src/apps/control-plane-worker/README.md)

## Adding And Managing Config

Use module ownership to keep config changes localized:

- `src/global/*` owns `global.*`
- `src/apps/<app-id>/*` owns `apps.<app_id>.*`

### Add A New Key To An Existing Module

1. Update the module schema in `schema.ts` (source of truth for runtime validation and types).
2. Update `load-toml.ts` with the TOML path and parsing logic for the new key.
3. Update `load-env.ts` with the env mapping and parsing logic for the new key.
4. Update [`src/conversion-mappings.ts`](./src/conversion-mappings.ts) so env <-> TOML conversion helpers include the new key mapping.
5. Update the module `README.md` table (Type, TOML key, Env key, defaults).
6. Update [`../../config/config.sample.toml`](../../config/config.sample.toml) with the production-centric sample value.
7. If development init should populate the key, update `scripts/config/presets/development/*.ts` defaults and/or generators.
8. Add or update tests:
   - unit tests in `src/**/*test.ts` for parsing/merge/validation behavior
   - integration coverage in `integration/load-config.integration.test.ts` (and fixture updates if needed)

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
3. Update `src/loader.ts` app parsing branch/map so `loadConfig` can parse and return the app config for the new app id.
4. Update [`src/conversion-mappings.ts`](./src/conversion-mappings.ts) with env <-> TOML mappings for the app module keys.
5. Add the app section in [`../../config/config.sample.toml`](../../config/config.sample.toml).
6. Add module docs link in this README.
7. Add integration test coverage for TOML-only, env-only, and merged precedence cases.

### Quick Validation

Run:

- `pnpm --filter @mistle/config lint`
- `pnpm --filter @mistle/config typecheck`
- `pnpm --filter @mistle/config test:all`
