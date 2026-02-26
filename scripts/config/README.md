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
  - Writes `config/config.development.toml` once.
- If the target file already exists, it exits without overwriting.

## CI Init Script

- Command: `pnpm config:init:ci`
- Script: `scripts/config/init-ci.ts`
- Output: `config/config.ci.toml`
- Behavior:
  - Reads `config/config.sample.toml`.
  - Applies deterministic CI overrides.
  - Writes `config/config.ci.toml` (overwrites on each run).

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

## Preset Modules

Development preset modules live under `scripts/config/presets/development/`.

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
