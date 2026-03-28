# scripts/config

Maintainer docs for local config initialization scripts.

## Development Init Script

- Command: `pnpm config:init:dev`
- Script: `scripts/config/init-development.ts`
- Output: `config/config.development.toml`
- Behavior:
  - Reads `config/config.sample.toml`.
  - Applies development preset defaults.
  - Applies development preset generators.
  - Writes `config/config.development.toml` (overwrites on each run).

## Integration Init Script

- Command: `pnpm config:init:integration`
- Script: `scripts/config/init-integration.ts`
- Output:
  - `config/config.integration.docker.toml`
  - `config/config.integration.e2b.toml`
- Behavior:
  - Reads `config/config.sample.toml`.
  - Applies development preset defaults and generators as the integration baseline.
  - Shapes the config per requested sandbox provider from `MISTLE_TEST_SANDBOX_INTEGRATION_PROVIDERS`.
  - Overlays canonical runtime config env vars onto the generated TOML.
  - Writes one provider-specific integration config file per requested provider.

## Conversion Scripts

- Env file to TOML:
  - Command:
    - `pnpm config:convert:env-to-toml -- --input .env.development --output config/config.development.toml`
  - Behavior:
    - Reads dotenv-style key/value pairs.
    - Converts known runtime config env vars into TOML keys.
    - Writes the target TOML file.
- TOML to env file:
  - Command:
    - `pnpm config:convert:toml-to-env -- --input config/config.development.toml --output .env.development`
  - Behavior:
    - Reads TOML config.
    - Converts known runtime config TOML keys into env vars.
    - Writes the target dotenv file.

Notes:

- Conversion currently covers `@mistle/config` managed runtime modules (global plus control/data plane apps).
- Unknown keys are ignored.
- `config:init:integration` expects `MISTLE_TEST_SANDBOX_INTEGRATION_PROVIDERS` to be set.

## Preset Modules

Development preset modules live under `scripts/config/presets/development/`.

Integration provider presets live under `scripts/config/presets/integration/`.

Each module exports:

- `defaults`: static values merged onto the sample config.
- `generators`: dynamic value rules for computed values (for example secrets).

`scripts/config/presets/development/index.ts` composes these modules into
`developmentPresetModules`.

## Generator Contract

Each generator has this shape:

- `path: string[]`
  - Dot-path segments to the output field.
  - Example: `["global", "auth", "key"]`
- `when?: "missing"`
  - `"missing"` means run only when the target value is `undefined`.
- `generate({ config, currentValue }) => unknown`
  - Returns the generated value written to `path`.

Example:

```js
{
  path: ["global", "auth", "key"],
  when: "missing",
  generate: () => randomBytes(32).toString("hex"),
}
```

## Conventions

- Keep presets scoped by domain (`global`, app-specific modules, etc.).
- Prefer `defaults` for deterministic values.
- Use `generators` only for values that should be computed at init time.
- Keep the init command no-arg and deterministic aside from explicit generators.
