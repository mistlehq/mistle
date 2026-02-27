# @mistle/test-environments

Composed integration/system/e2e test environments built on top of `@mistle/test-core`.

For integration test authors, the primary API is `startIntegrationEnvironment(...)`.

## Intended Consumers

Use this package from:

- `apps/dashboard`
- `tests/system`
- `tests/e2e`

Do not use this package from backend app workspaces (for example `apps/control-plane-api`, `apps/control-plane-worker`, `apps/data-plane-*`), because those apps are runtime dependencies of prewired environments and importing back introduces dependency cycles.

## Modules

- [Backend Integration Environment](./src/environment/backend-integration/README.md)

## Scripts

- `pnpm --filter @mistle/test-environments build`
- `pnpm --filter @mistle/test-environments lint`
- `pnpm --filter @mistle/test-environments typecheck`
- `pnpm --filter @mistle/test-environments test`
- `pnpm --filter @mistle/test-environments format`
- `pnpm --filter @mistle/test-environments format:check`
