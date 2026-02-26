# scripts/config

Maintainer docs for local config initialization scripts.

## Development Init Script

- Command: `pnpm config:init:dev`
- Script: `scripts/config/init-development.mjs`
- Output: `config/config.development.toml`
- Behavior:
  - Reads `config/config.sample.toml`.
  - Applies development preset defaults.
  - Applies development preset generators.
  - Writes `config/config.development.toml` once.
- If the target file already exists, it exits without overwriting.

## CI Init Script

- Command: `pnpm config:init:ci`
- Script: `scripts/config/init-ci.mjs`
- Output: `config/config.ci.toml`
- Behavior:
  - Reads `config/config.sample.toml`.
  - Applies deterministic CI overrides.
  - Writes `config/config.ci.toml` (overwrites on each run).

## Preset Modules

Development preset modules live under `scripts/config/presets/development/`.

Each module exports:

- `defaults`: static values merged onto the sample config.
- `generators`: dynamic value rules for computed values (for example secrets).

`scripts/config/presets/development/index.mjs` composes these modules into
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
