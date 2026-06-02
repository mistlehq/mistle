# scripts/config

Maintainer docs for local config initialization scripts.

## Development Init Script

- Command: `pnpm config:init:dev`
- Script: `scripts/config/init-development.ts`
- Output: `config/config.development.toml`
- Behavior:
  - Generates the resource-oriented TOML shape.
  - Generates local-only secrets at init time.
  - Preserves generated section comments for operator-facing guidance.
  - Writes `config/config.development.toml` (overwrites on each run).
  - Validates the result through `@mistle/config`.

## Integration Init Script

- Command: `pnpm config:init:integration`
- Script: `scripts/config/init-integration.ts`
- Output: `config/config.integration.toml`
- Behavior:
  - Generates the resource-oriented TOML shape.
  - Uses the development config as the integration baseline.
  - Enables requested sandbox provider config from `MISTLE_TEST_SANDBOX_INTEGRATION_PROVIDERS`.
  - Applies the existing env override names that are still needed while the env surface remains stable.
  - Preserves generated section comments for operator-facing guidance.
  - Writes one shared integration config file.
  - Validates the result through `@mistle/config`.

## Notes

- Generated development and integration TOML files use the resource-oriented shape.
- `config:init:integration` expects `MISTLE_TEST_SANDBOX_INTEGRATION_PROVIDERS` to be set.
- Integration configs with E2B or Tensorlake enabled require only that provider's
  API key and a remote sandbox base image.

## Preset Modules

The shared config builder and comment-preserving writer live in
`scripts/config/toml-config.ts`.

Integration provider metadata lives under `scripts/config/presets/integration/`.

## Conventions

- Keep generated TOML in the resource-oriented shape.
- Keep generated comments useful for operators.
- Keep generated config scripts aligned with the current resource-oriented env names.
- Keep the init command no-arg and deterministic aside from explicit generators.
