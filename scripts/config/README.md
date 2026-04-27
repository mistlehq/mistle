# scripts/config

Maintainer docs for local config initialization scripts.

## Development Init Script

- Command: `pnpm config:init:dev`
- Script: `scripts/config/init-development.ts`
- Output: `config/config.development.toml`
- Behavior:
  - Generates the next TOML shape.
  - Generates local-only secrets at init time.
  - Preserves generated section comments for operator-facing guidance.
  - Writes `config/config.development.toml` (overwrites on each run).
  - Validates the result through `@mistle/config` with `format: "next"`.

## Integration Init Script

- Command: `pnpm config:init:integration`
- Script: `scripts/config/init-integration.ts`
- Output:
  - `config/config.integration.docker.toml`
  - `config/config.integration.e2b.toml`
- Behavior:
  - Generates the next TOML shape.
  - Uses the development next config as the integration baseline.
  - Shapes the config per requested sandbox provider from `MISTLE_TEST_SANDBOX_INTEGRATION_PROVIDERS`.
  - Applies the legacy env override names that are still needed while the env surface remains stable.
  - Preserves generated section comments for operator-facing guidance.
  - Writes one provider-specific integration config file per requested provider.
  - Validates each result through `@mistle/config` with `format: "next"`.

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
- Generated development and integration TOML files use the next shape. Runtime
  consumers must set `MISTLE_CONFIG_FORMAT=next` when these files are supplied
  through `MISTLE_CONFIG_PATH`.
- `config:init:integration` expects `MISTLE_TEST_SANDBOX_INTEGRATION_PROVIDERS` to be set.
- Docker integration configs use `sandbox.storage.backend = "docker_volume"`.
- E2B integration configs use Archil-backed storage and require a fully
  populated managed Archil profile via env, including `api_key`, `region`, and
  one S3-compatible mount.
- Archil-backed development and test configs should point at a real remote
  S3-compatible bucket. Do not assume the local SeaweedFS object store is a
  supported Archil backing store.

## Preset Modules

The shared next config builder and comment-preserving writer live in
`scripts/config/next-config.ts`.

Integration provider metadata lives under `scripts/config/presets/integration/`.

## Conventions

- Keep generated TOML in the next shape.
- Keep generated comments useful for operators.
- Keep env support limited to the existing `MISTLE_GLOBAL_*` and
  `MISTLE_APPS_*` override names until the env surface gets its own migration.
- Keep the init command no-arg and deterministic aside from explicit generators.
