# Test Environment Harness

The environment harness is the source of truth for dependency-bearing
integration tests. It owns service startup, infrastructure provisioning,
pooling, clients, and cleanup so application developers can write tests without
juggling containers, ports, databases, or service lifecycle details.

## Test Author API

New integration tests should use `createIntegrationTest` from
`@mistle/test-harness/integration`.

```ts
import { createIntegrationTest } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe("cors integration", () => {
  it("adds CORS headers for trusted origins", async ({ env }) => {
    const response = await env.controlPlaneApi.http.fetch("/__healthz", {
      headers: {
        origin: env.controlPlaneApi.hostBaseUrl,
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      env.controlPlaneApi.hostBaseUrl,
    );
  });
});
```

For the common case, service selection is just service ids:

```ts
const it = createIntegrationTest({
  services: ["control-plane-api", "data-plane-api"],
});
```

String service selections use `runtime` mode by default. Runtime mode is the
default for integration tests because it is the lightest way to run Mistle
services against real infrastructure.

Only request a non-runtime mode when the behavior under test requires that mode
and the harness service definition supports it. Docker mode should be uncommon
in integration tests. Use it for packaging or deployment-shape behavior, not as
the default way to test application behavior.

## Test Shape

Tests receive one fixture field: `env`.

```ts
it("responds to health checks", async ({ env }) => {
  const response = await env.controlPlaneApi.http.fetch("/__healthz");

  expect(response.status).toBe(200);
});
```

Do not expose extra fixture fields such as `controlPlaneApi`, `trustedOrigin`,
`postgres`, or `registry` unless there is a proven repeated need. Prefer adding
well-named properties under `env`.

Tests should assert observable behavior through service handles. They should not
know how the service was started, which infrastructure was provisioned, which
ports were reserved, or how cleanup works.

## Database Access

Use the database handles on `env` when a test needs to seed or inspect persisted
state:

```ts
await env.dataPlaneDb.insert(sandboxInstances).values({
  id: sandboxInstanceId,
  // ...
});
```

The harness owns the underlying `pg.Pool` instances. Tests should not create
their own database pools or read raw database URLs from infrastructure metadata.
The fixture closes harness-managed pools before releasing the logical
environment, which keeps connection usage bounded in parallel runs.

## Service Selection And Peers

Select only the services the test intentionally exercises:

```ts
const it = createIntegrationTest({
  services: ["control-plane-api"],
});
```

Service config is resolved from the selected environment. When a selected
service references another selected service, the harness wires the real peer
endpoint into config. For example, selecting both `control-plane-api` and
`data-plane-api` gives the control-plane API the real data-plane API base URL.

Unselected peers are allowed for subset tests. Some production configs require
peer URLs even when the route under test does not use them. In that case the
harness supplies an intentionally unreachable missing-peer URL. This does not
simulate the peer; it lets the service boot and makes accidental peer usage fail
through the real network path.

Service references are still not auto-start dependencies. They only affect
startup ordering and endpoint wiring among services that the test explicitly
selected.

## Files And Commands

New and migrated integration tests live in `apps/*/integration-new/`.

Each package with migrated tests should expose:

- `vitest.integration-new.config.ts`
- `test:integration:new`

Run all currently migrated new-lane integration tests from the repo root:

```bash
pnpm test:integration:new
```

The root command uses one integration runner session across all selected
projects, so pooled physical infrastructure and pooled services can be reused.

Run one package through the same root runner:

```bash
pnpm test:integration:new -- --project @mistle/data-plane-gateway
```

Run one file through the same root runner when pooling or timing behavior
matters:

```bash
pnpm test:integration:new -- --project @mistle/data-plane-gateway integration-new/gateway-restart.integration.test.ts
```

Detailed setup timing is opt-in:

```bash
MISTLE_TEST_TIMING=1 pnpm test:integration:new
```

For targeted single-file debugging, use direct package Vitest execution:

```bash
pnpm --filter @mistle/data-plane-gateway exec vitest run -c vitest.integration-new.config.ts integration-new/gateway-restart.integration.test.ts
```

Direct package Vitest execution is useful for tight local debugging, but it is
not the canonical way to measure full-suite pooling or timing behavior.

The old `apps/*/integration/` lane is legacy. Keep it working while migrating,
but do not add new coverage there.

## Harness Author API

Most application developers should not need this section. Use it when adding or
changing harness support for a service.

The implementation has three explicit steps.

### 1. Define Services And Create A Registry

Service definitions describe how to start a service and which real
infrastructure it needs.

```ts
const controlPlaneApi: TestServiceDefinition = {
  id: "control-plane-api",
  infra: [postgres],
  serviceReferences: [],
  supportedModes: ["runtime"],
  healthCheck: checkControlPlaneApiHealth,
  start: startControlPlaneApiRuntime,
};

const registry = createServiceRegistry({
  services: {
    "control-plane-api": controlPlaneApi,
  },
});
```

Keep `createServiceRegistry(...)` separate from environment startup. This makes
the service catalog explicit and keeps startup policy visible.

### 2. Start The Test Environment

`startTestEnvironment(...)` starts only the selected services. Service
references affect ordering and wiring among selected services; they must not
auto-start hidden dependencies.

```ts
const environment = await startTestEnvironment({
  registry,
  services: [{ service: "control-plane-api", mode: "runtime" }],
});
```

### 3. Set The Fixture

Use a Vitest fixture to guarantee cleanup and expose one `env` object.

```ts
export const it = base.extend<{ env: ControlPlaneApiIntegrationEnvironment }>({
  env: [
    async ({}, use) => {
      const environment = await startTestEnvironment({
        registry,
        services: [{ service: "control-plane-api", mode: "runtime" }],
      });

      try {
        await use(toControlPlaneApiIntegrationEnvironment(environment));
      } finally {
        await environment.stop();
      }
    },
    { scope: "file" },
  ],
});
```

Do not hide these steps behind one-off helper functions. Extract a helper only
after multiple real callsites prove the duplication is stable.

## Public API Discipline

Keep the public surface small.

Public APIs should be stable concepts used by many tests:

- `createIntegrationTest(...)`
- `startTestEnvironment(...)`
- `createTestRegistry(...)`
- `createServiceRegistry(...)`
- `defineTestServiceRegistry(...)`
- `reserveAvailablePort(...)`
- core types needed to implement harness support

Do not export app-specific wrappers, infra value constants, or helper functions
for a single fixture. Keep those local until there is a real shared abstraction.

## Infrastructure

Infrastructure belongs to service definitions, not tests.

A service definition declares logical requirements such as Postgres, Valkey, or
Mailpit. Provisioners can reuse one physical Testcontainers resource while
creating isolated logical state per environment: databases, workflow namespaces,
Valkey prefixes, buckets, temp directories, and logs.

Tests should not hand-roll Testcontainers resources when the harness can model
the dependency. If a service needs new infrastructure, add it to the harness
service definition.

## Pooling And Cleanup

The default policy is pooled physical infrastructure and pooled stateless
services. Every environment receives isolated logical state and a unique
`env.id`.

`env.stop()` releases the environment's leases:

- logical infra for that environment is cleaned up;
- physical infra stays alive while other leases still use it;
- pooled services stay alive while other leases still use them;
- isolated services stop with the environment.

Always call `environment.stop()` from a `finally` block in fixtures. Service
handles close harness-managed HTTP clients during cleanup, which avoids
unbounded connection churn in large parallel suites.

Use dangerous isolation only when the test mutates a service process itself:

```ts
const it = createIntegrationTest({
  services: ["data-plane-gateway"],
  __dangerouslyIsolatedServices: {
    reason: "This test restarts the gateway process and must not affect parallel tests.",
    services: ["data-plane-gateway"],
  },
});
```

The `reason` is required so reviewers can distinguish true lifecycle tests from
tests that should rely on normal logical isolation.

## What Not To Do

- Do not add new tests to the legacy `integration/` lane.
- Do not make app developers define registries, provisioners, or service
  launchers in ordinary test files.
- Do not expose many fixture fields when one `env` object is enough.
- Do not add exported helpers for one app's current wiring.
- Do not use Docker mode as the default proof for lightweight integration
  tests.
- Do not make service references auto-start hidden dependencies.
