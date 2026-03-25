# Integration Target Provisioning Spec

## Goals

- Keep `mistle` provider-agnostic.
- Support operator-managed integration target config and secrets across local development, staging, and production.
- Make integration target reconciliation an explicit operator action instead of coupling it to database migrations.
- Keep non-secret manifest content in Git and sensitive values outside Git.

## Non-Goals

- No Infisical-specific code or CLI usage inside `mistle`.
- No backward-compatibility layer for the old `db:seed:integration-targets` command surface.

## Public Command Surface

Expose one operator-facing command:

```bash
pnpm --filter @mistle/control-plane-api integration-targets:sync
```

This command must:

1. sync definition-backed `integration_targets` rows from the integration registry
2. optionally provision operator-owned config and secrets from a manifest, if one is supplied

`db:migrate` must only run database migrations.

## Manifest File

The checked-in manifest file name remains:

```txt
integration-targets.provision.json
```

Manifest source precedence:

1. `MISTLE_INTEGRATION_TARGETS_PROVISION_MANIFEST_JSON`
2. `MISTLE_INTEGRATION_TARGETS_PROVISION_MANIFEST_PATH`
3. discovered `integration-targets.provision.json` by walking upward from the current working directory to the repository root

## Manifest Schema

Top-level schema:

```json
{
  "version": 1,
  "targets": []
}
```

Each target:

```json
{
  "targetKey": "github-cloud",
  "enabled": true,
  "config": {
    "api_base_url": "https://api.github.com",
    "web_base_url": "https://github.com",
    "app_slug": "mistle",
    "app_id": "123456",
    "client_id": "Iv1.xxx"
  },
  "secretEnv": {
    "app_private_key_pem": "MISTLE_INTEGRATION_TARGET_GITHUB_CLOUD_APP_PRIVATE_KEY_PEM",
    "webhook_secret": "MISTLE_INTEGRATION_TARGET_GITHUB_CLOUD_WEBHOOK_SECRET"
  }
}
```

Rules:

- `config` is always non-secret and lives in Git.
- Exactly one of `secrets` or `secretEnv` may be supplied for a target.
- If neither `secrets` nor `secretEnv` is supplied, the target has no secrets.
- `secretEnv` values must resolve from process environment.
- Missing or empty `secretEnv` variables are hard errors.
- Escaped newline normalization applies to both literal `secrets` values and env-resolved secret values.

## Local Development

`mistle` must remain unaware of Infisical.

Developers may still use an external workflow such as:

```bash
infisical run -- pnpm --filter @mistle/control-plane-api integration-targets:sync
```

That is acceptable because:

- `mistle` only consumes environment variables
- the secret manager remains an external concern

Local development may also use literal `secrets` in `integration-targets.provision.json` when needed.

## Staging and Production

### Ownership Split

- `mistle`
  - manifest schema
  - manifest loading and env resolution
  - registry sync
  - provisioning logic
- `mistle-infra`
  - environment-specific manifest content
  - cloud secret distribution
  - Kubernetes execution path for the sync command
- Infisical
  - source of truth for sensitive integration target values

### Infisical Folder Layout

Use a top-level folder:

```txt
integration-targets/
```

Do not nest these under `control-plane/`, because they should not flow into the normal runtime secret aggregation path.

### Google Secret Manager Sync

Use a separate Infisical -> GSM sync for integration target secrets.

Recommended key schema:

```txt
INTEGRATION_TARGETS__{{secretKey}}
```

Rationale:

- avoids collisions with the main runtime secret sync
- keeps provisioning-only secrets separate from `mistle-runtime`

### Kubernetes Materialization

Use a separate `ExternalSecret` and a separate Kubernetes `Secret`:

- Kubernetes Secret name:
  - `mistle-integration-targets`

Do not merge these keys into `mistle-runtime`.

### Execution Model

Run integration target reconciliation as a dedicated one-off Kubernetes `Job`, for example:

- Job name:
  - `mistle-integration-targets-sync`

The Job should receive:

- runtime DB/config env needed by the control-plane app
- manifest JSON or mounted manifest file
- target secret env vars from `mistle-integration-targets`

Then run:

```bash
pnpm --filter @mistle/control-plane-api integration-targets:sync
```

## Recommended Rollout

1. add `secretEnv` support to the manifest loader
2. add the new `integration-targets:sync` command
3. remove integration-target provisioning from `db:migrate`
4. update examples and docs
5. wire staging/production provisioning in `mistle-infra`
