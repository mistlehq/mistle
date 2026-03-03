# @mistle/test-harness

Real test infrastructure for integration, system, and e2e tests.

This package is for test-time dependency orchestration (containers + service clients), so apps can test real boundaries without mocks/stubs/fakes.

Compose test-specific environments locally in each app/package using these primitives.

## Public API

Exported from [`src/index.ts`](./src/index.ts):

- `startMailpit`
- `MailpitService`
- `startPostgresWithPgBouncer`
- `PostgresWithPgBouncerService`
- `reserveAvailablePort`
- `startWorkspaceApp`
- `startDockerTargetApp`
- `startDockerHttpApp`
- `startControlPlaneApi`
- `startControlPlaneWorker`
- `startDataPlaneApi`
- `startDataPlaneWorker`
- `startDataPlaneGateway`
- `startTokenizerProxy`

## Service Modules

- [Mailpit service](./src/services/mailpit/README.md)
- [Postgres + PgBouncer service](./src/services/postgres/README.md)

## App Modules

- `src/apps/shared.ts`: generic launchers for workspace-mounted and Docker-target app containers (`startDockerTargetApp(...)` supports `cacheBustKey` to force rebuilding a Docker target image in-process)
- `src/apps/http-app.ts`: shared HTTP app startup helper used by per-app launchers
- `src/apps/control-plane-api.ts`
- `src/apps/control-plane-worker.ts`
- `src/apps/data-plane-api.ts`
- `src/apps/data-plane-worker.ts`
- `src/apps/data-plane-gateway.ts`
- `src/apps/tokenizer-proxy.ts`

Dockerfile-based app launchers expect prebuilt `dist` artifacts in the build context (for example run `pnpm --filter @mistle/control-plane-api... build` before `startControlPlaneApi(...)`).

As more services are added, each service should include its own `README.md` with focused setup and usage examples.

## Scripts

- `pnpm --filter @mistle/test-harness build`
- `pnpm --filter @mistle/test-harness lint`
- `pnpm --filter @mistle/test-harness typecheck`
- `pnpm --filter @mistle/test-harness test`
- `pnpm --filter @mistle/test-harness format`
- `pnpm --filter @mistle/test-harness format:check`
