# @mistle/test-harness

Real test infrastructure for integration, system, and e2e tests.

The package exists so tests exercise real dependency boundaries without
mocking, stubbing, faking, or hand-rolling app-local infrastructure. It owns the
shared primitives for service startup, containers, ports, clients, pooling, and
cleanup.

## Start Here

Ordinary app integration tests should use the new environment harness:

- API: `createIntegrationTest(...)` from `@mistle/test-harness/integration`
- Guide: [Test Environment Harness](./src/environment/README.md)
- Test location: `apps/*/integration-new/`
- Suite command: `pnpm test:integration:new`

Most app tests should not call low-level container or app launchers directly.
Use the environment harness so tests share pooled infrastructure, get isolated
logical state, and expose one stable `{ env }` fixture.

## Integration API

Exported from `@mistle/test-harness/integration`:

- `createIntegrationTest(...)`
- `TestEnvironmentIdHeader`
- `IntegrationTestEnvironment`
- `IntegrationAuth`
- `IntegrationAuthenticatedSession`

Example:

```ts
import { createIntegrationTest } from "@mistle/test-harness/integration";
import { expect } from "vitest";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

it("serves health checks", async ({ env }) => {
  const response = await env.controlPlaneApi.http.fetch("/__healthz");

  expect(response.status).toBe(200);
});
```

## Lower-Level APIs

Exported from [`src/index.ts`](./src/index.ts):

- service and container primitives such as `startMailpit`,
  `startPostgresWithPgBouncer`, `startSeaweedFsS3`, `startValkey`,
  `startWorkspaceApp`, and Docker app launchers;
- network helpers such as `reserveAvailablePort`;
- environment internals such as `startTestEnvironment(...)`,
  `createTestRegistry(...)`, and `createServiceRegistry(...)`;
- system environment helpers such as `startFullSystemEnvironment`.

These APIs are for harness implementation, system/e2e orchestration, and legacy
tests that have not yet moved to `integration-new`. Do not use them as the
normal public API for new app integration tests.

## Service Modules

- [Mailpit service](./src/services/mailpit/README.md)
- [Postgres + PgBouncer service](./src/services/postgres/README.md)
- [SeaweedFS service](./src/services/seaweedfs/README.md)

## App Modules

- `src/apps/shared.ts`: generic launchers for workspace-mounted and
  Docker-target app containers. `startDockerTargetApp(...)` supports
  `cacheBustKey` to force rebuilding a Docker target image in-process.
- `src/apps/http-app.ts`: shared HTTP app startup helper used by per-app
  launchers.
- `src/apps/control-plane-api.ts`
- `src/apps/control-plane-worker.ts`
- `src/apps/data-plane-api.ts`
- `src/apps/data-plane-worker.ts`
- `src/apps/data-plane-gateway.ts`
- `src/apps/tokenizer-proxy.ts`

Dockerfile-based app launchers expect prebuilt `dist` artifacts in the build
context. For example, run
`pnpm --filter @mistle/control-plane-api... build` before
`startControlPlaneApi(...)`.

As more services are added, each service should include focused setup and usage
notes in the environment guide or its service-specific README.

## Scripts

- `pnpm --filter @mistle/test-harness build`
- `pnpm --filter @mistle/test-harness lint`
- `pnpm --filter @mistle/test-harness typecheck`
- `pnpm --filter @mistle/test-harness test`
- `pnpm --filter @mistle/test-harness format`
- `pnpm --filter @mistle/test-harness format:check`
