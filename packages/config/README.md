# @mistle/config

Central config package for Mistle apps.

`@mistle/config` loads configuration from one resource-oriented TOML root:

1. Load TOML as the base config.
2. Apply env overrides into the same central root.
3. Select the requested service config from shared resources and service-owned sections.
4. Validate the selected service config.

The public operator sample at [`../../config/config.sample.toml`](../../config/config.sample.toml)
uses the resource-oriented TOML shape.

## Public API

The package exports these public APIs from [`src/index.ts`](./src/index.ts):

- `loadConfig(options)`
- `AppIds`
- `exportServiceConfigToEnv(input)`
- `projectServiceConfigToEnv(input)` as a compatibility alias for
  `exportServiceConfigToEnv`

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

Env overrides are still applied after TOML is loaded, so the existing
`MISTLE_GLOBAL_*` and `MISTLE_APPS_*` env variables keep their current override
behavior.

`includeGlobal` defaults to `true`.

Return shape:

- with `includeGlobal: true` (default): `{ global, app }`
- with `includeGlobal: false`: `{ app }`

`app` is type-safe and inferred from `options.app` (for example, `AppIds.CONTROL_PLANE_API` returns the control-plane-api app config shape).

## Merge Rules

- TOML is loaded first.
- Env values are loaded second into the central config root.
- Env values override TOML when both provide the same config key.
- The requested service config is selected from the merged root.

## Module Docs

- [Global module](./src/global/README.md)
- [Control Plane API module](./src/apps/control-plane-api/README.md)
- [Control Plane Worker module](./src/apps/control-plane-worker/README.md)
- [Data Plane API module](./src/apps/data-plane-api/README.md)
- [Data Plane Gateway module](./src/apps/data-plane-gateway/README.md)
- [Data Plane Worker module](./src/apps/data-plane-worker/README.md)
- [Tokenizer Proxy module](./src/apps/tokenizer-proxy/README.md)

## Adding And Managing Config

Use module ownership to keep config changes localized:

- `src/global/*` owns `global.*`
- `src/apps/<app-id>/*` owns the selected service config schema.
- `src/root/schema.ts` owns the central resource-oriented config schema.
- `src/root/selectors.ts` owns service selectors from central resources.
- `src/root/load-env.ts` owns legacy env override compatibility into the central root.
- `src/apps/<app-id>/legacy-env-descriptors.ts` and
  `src/global/legacy-env-descriptors.ts` own the legacy runtime env surface used
  by `exportServiceConfigToEnv`.
- `src/runtime-env-export.ts` owns selected service config to runtime env export
  while services still consume the legacy env surface.
- `src/toml.ts` owns TOML parsing helpers only.

### Add A New Key To An Existing Module

1. Update the module schema in `schema.ts` (source of truth for runtime validation and types).
2. If the key is operator-facing config, update `src/root/schema.ts`,
   `src/root/load-env.ts`, and any service selectors in `src/root/selectors.ts`
   that consume it.
3. If the key must still be exported to a service runtime env var, update the
   relevant `legacy-env-descriptors.ts` file and `src/runtime-env-export.ts`.
4. Update [`../../config/config.sample.toml`](../../config/config.sample.toml) with the production-centric sample value.
5. If generated config should populate the key, update `scripts/config/toml-config.ts`.
6. Add or update tests:
   - unit tests in `src/**/*test.ts` for parsing/merge/validation behavior
   - integration coverage in `integration/load-config.integration.test.ts` (and fixture updates if needed)

### Add A New App Module

1. Create `src/apps/<app-id>/` with:
   - `schema.ts`
   - `legacy-env-descriptors.ts` if the service still needs runtime env export
   - `index.ts` (exports the `ConfigModule`)
   - `README.md` (single config table)
2. Register the app in `src/modules.ts`:
   - add `AppIds.<NEW_APP>`
   - add to `appConfigModules`
3. Update `src/loader.ts` app parsing branch/map so `loadConfig` can parse and return the app config for the new app id.
4. Add the service selector for the app in `src/root/selectors.ts` if central config should configure it.
5. Add the service/resource sections in [`../../config/config.sample.toml`](../../config/config.sample.toml).
6. Add module docs link in this README.
7. Add integration test coverage for TOML-only, env-only, and merged precedence cases.

### Quick Validation

Run:

- `pnpm --filter @mistle/config lint`
- `pnpm --filter @mistle/config typecheck`
- `pnpm --filter @mistle/config test:all`
