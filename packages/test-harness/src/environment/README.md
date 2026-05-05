# Test Environment Harness

The environment harness is the source of truth for dependency-bearing
integration tests. It owns service startup, infrastructure provisioning,
pooling, clients, logical isolation, and cleanup so application developers can
write behavior-focused tests without juggling containers, ports, databases, or
service lifecycle details.

This document is the practical guide for writing harness-backed app integration
tests. Harness implementation details are covered near the end for contributors
who are adding service support.

## Mental Model

An `integration` test has one primary subject: the app, service, worker, or
production entrypoint whose behavior is being verified. The test may compose any
other real Mistle services required to exercise that behavior.

The harness layers are:

1. The root runner (`pnpm test:integration`) creates one run session and
   prewarms shared physical infrastructure when possible.
2. `createIntegrationTest(...)` declares the services and optional extra
   infrastructure needed by a test file.
3. The service registry maps service ids to runtime/process/docker launchers,
   required infrastructure, peer wiring, health checks, and pooling policy.
4. `startTestEnvironment(...)` builds a plan, provisions infrastructure, starts
   selected services, and returns a logical environment id.
5. The `env` fixture exposes service handles, reusable clients, bound database
   tables, workflow clients, auth helpers, and optional infrastructure clients.

Physical infrastructure is pooled across the runner. Logical state is isolated
per environment through schemas, namespaces, buckets, prefixes, and
`env.id`-scoped service requests. Stateless services are pooled by default; tests
that restart or stop a service must opt into dangerous isolation.

## Quick Start

New integration tests should use `createIntegrationTest` from
`@mistle/test-harness/integration`.

```ts
/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { createIntegrationTest } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("control-plane API health integration", () => {
  it("serves health checks", async ({ env }) => {
    const response = await env.controlPlaneApi.http.fetch("/__healthz");

    expect(response.status).toBe(200);
  });
});
```

The test receives one fixture field: `env`. Do not expose extra fixture fields
such as `controlPlaneApi`, `postgres`, or `registry` in ordinary app tests.
Service handles and clients belong under `env`.

## Choosing Services

Select every live Mistle service that the test intentionally exercises:

```ts
const it = createIntegrationTest({
  services: ["control-plane-api", "data-plane-api"],
});
```

String service selections use `runtime` mode by default. Runtime mode is the
normal integration-test mode because it is the lightest way to run Mistle
services against real infrastructure.

Only request a non-runtime mode when the behavior under test requires that mode
and the harness service definition supports it:

```ts
const it = createIntegrationTest({
  services: [{ service: "control-plane-api", mode: "process" }],
});
```

Docker mode should be uncommon in integration tests. Use it for packaging or
deployment-shape behavior, not as the default way to test application behavior.

Service references are wiring and ordering hints, not hidden dependencies. If a
test selects both `control-plane-api` and `data-plane-api`, the harness wires the
real data-plane API URL into the control-plane API config. If the data-plane API
is not selected, the harness may provide an intentionally unreachable
missing-peer URL so the selected service can boot; accidentally using that peer
will fail through the real network path.

## Choosing The Entrypoint

Prefer the production entrypoint that matches the behavior being tested.

Use HTTP when the contract, routing, auth, validation, serialization, or
side-effect orchestration is part of the behavior:

```ts
const response = await env.controlPlaneApi.http.fetch("/v1/organization", {
  headers: {
    cookie: session.cookie,
  },
});
```

Use a workflow/client entrypoint when the worker behavior itself is the subject:

```ts
const handle = await env.dataPlaneWorkflow.runWorkflow(HandleSandboxInstanceDeadlineWorkflowSpec, {
  sandboxInstanceId,
  kind,
  ownerLeaseId,
  dueAt,
  generation,
});

expect(await handle.result({ timeoutMs: 15_000 })).toEqual({
  sandboxInstanceId,
  kind,
  executed: false,
  outcome: "deadline_generation_mismatch",
});
```

`integration` is not limited to HTTP tests. It is the lane for
dependency-bearing app/service behavior, whether the entrypoint is HTTP, a
worker workflow, a production service/module function, or another real code
path.

## Environment Fixture

`env` is file-scoped. Tests in the same file share one logical environment and
therefore share that file's logical database schemas, workflow namespaces,
service handles, and optional infra clients.

Use unique ids or per-test organizations when data could collide. Prefer
`describe.concurrent(...)` when scenarios are independent. Keep a file
sequential only when scenarios intentionally depend on ordering, mutate shared
setup, restart/stop services, or require another exclusive resource; make that
reason obvious in the test file.

Common `env` properties include:

- `env.id`: the logical test environment id.
- `env.auth`: helpers for creating authenticated control-plane sessions.
- `env.controlPlaneApi`, `env.dataPlaneApi`, `env.dataPlaneGateway`,
  `env.tokenizerProxy`: service handles with `hostBaseUrl` and reusable HTTP
  clients.
- `env.controlPlaneDb`, `env.dataPlaneDb`: harness-managed Drizzle database
  handles.
- `env.controlPlaneTables`, `env.dataPlaneTables`: schema-bound Drizzle tables
  for inserts, updates, deletes, joins, and predicates.
- `env.dataPlaneGatewayRuntimeState`: the data-plane gateway runtime-state
  Valkey URL and logical key prefix. Use this only for gateway runtime-state
  store integration tests that exercise the production Valkey store classes
  directly.
- `env.controlPlaneWorkflow`: workflow client for control-plane worker behavior.
- `env.dataPlaneWorkflow`: workflow client for data-plane worker behavior.
- `env.mailpit`, `env.objectStore`, `env.otlpCollector`: optional clients
  available only when the matching `extraInfra` was requested and attached to a
  selected service.

## Authentication

Use `env.auth.createSession(...)` when a test needs an authenticated
control-plane user and organization.

```ts
const session = await env.auth.createSession({
  email: "integration-example@example.com",
  organizationName: "Integration Example",
});

const response = await env.controlPlaneApi.http.fetch("/v1/organization", {
  headers: {
    cookie: session.cookie,
  },
});
```

Tests using `env.auth` must select `control-plane-api`. Request `mailpit` only
when the scenario asserts email delivery through the worker; creating a session
through the helper does not by itself require email assertions.

## Database Access

Use database handles on `env` when a test needs to seed or inspect persisted
state. For query builders, use the bound tables from `env.controlPlaneTables` or
`env.dataPlaneTables` so the operation targets the logical test schema.

```ts
await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values({
  id: sandboxInstanceId,
  organizationId: organizationId,
  sandboxProfileId: sandboxProfileId,
  sandboxProfileVersion: 1,
  runtimeProvider: "docker",
  providerSandboxId: `provider-${sandboxInstanceId}`,
  status: SandboxInstanceStatuses.STARTING,
  startedByKind: "system",
  startedById: "workflow_integration_new",
  source: "webhook",
});
```

Prefer Drizzle's relational query API when reading:

```ts
const persisted = await env.dataPlaneDb.query.sandboxInstances.findFirst({
  where: (table, { eq }) => eq(table.id, sandboxInstanceId),
});
```

Do not import static table objects for runtime-style query builders in
integration tests. Static tables bind to the default schema and bypass logical
test isolation. The harness owns the underlying `pg.Pool` instances; tests
should not create their own pools or read raw database URLs from infra metadata.

## Extra Infrastructure

Service definitions declare the infrastructure they need to boot and serve
ordinary behavior. Tests should not request that baseline infrastructure
manually.

Some feature paths need additional physical infrastructure even though the
service can run without it. Request those dependencies explicitly with
`extraInfra`:

```ts
const it = createIntegrationTest({
  services: ["control-plane-api", "control-plane-worker"],
  extraInfra: ["mailpit"],
});
```

Supported extra infra ids are:

- `mailpit`: email delivery assertions, such as auth OTP flows through the
  control-plane worker.
- `otlp`: telemetry assertions through services that emit or forward OTLP
  requests, such as data-plane gateway sandbox tunnel telemetry.
- `seaweedfs`: object-store behavior, such as avatar or organization logo
  uploads through the control-plane API.

`extraInfra` is environment-scoped and should be rare. When an extra dependency
has a shareable physical backing resource, the harness pools it across the
runner and gives each logical environment its own scoped wiring, such as a
SeaweedFS bucket.

Optional clients fail fast if the matching infrastructure was not requested.
That is intentional; request `extraInfra` only when the scenario exercises that
feature path.

## External Services

Do not spin up ad hoc HTTP servers, local handlers, or app-local doubles to
emulate Mistle services. If a test needs a Mistle service, select that service
through `createIntegrationTest(...)`.

Ad hoc local servers are acceptable when the behavior under test is explicitly
about calling an external or non-Mistle upstream. For example, tokenizer-proxy
egress tests may use `startHttpEcho()` because the upstream is the outside
provider being called by Mistle.

Provider-auth behavior should use harness-owned provider switches instead of
app-local Better Auth setup. For Google id-token sign-in and linking coverage,
select the simulated Google auth boundary explicitly:

```ts
const it = createIntegrationTest({
  services: ["control-plane-api"],
  auth: {
    google: "simulated",
  },
});
```

This enables Google only for that test environment and keeps ordinary
`control-plane-api` service pooling unchanged. Tests should still exercise the
real control-plane API route and keep any simulated provider payload grounded in
official provider docs and production provider code.

## Dangerous Service Isolation

The default policy is pooled stateless services. Do not restart, stop, or mutate
pooled service processes.

Use dangerous isolation only when the test mutates a service process itself:

```ts
const it = createIntegrationTest({
  services: ["data-plane-api", "data-plane-gateway"],
  __dangerouslyIsolatedServices: {
    reason: "This suite intentionally restarts the data-plane gateway runtime.",
    services: ["data-plane-gateway"],
  },
});
```

The `reason` is required so reviewers can distinguish true lifecycle tests from
tests that should rely on normal logical isolation. Isolated service handles may
use lifecycle methods such as `restart()`. The harness preserves the service's
reserved endpoint across restart so tests can assert stable URLs and ports.

## Test Structure

Keep test bodies at the scenario level:

1. Arrange domain state.
2. Perform the user or service action.
3. Assert the observable outcome.

Move repetitive protocol mechanics, token minting, websocket choreography,
polling, object creation, and cleanup into well-named file-local helpers. Do not
promote those helpers to public harness APIs until multiple real tests prove the
abstraction is stable.

Good integration tests should read like behavior:

```ts
it("deletes an uploaded organization logo and removes the stored object", async ({ env }) => {
  const session = await env.auth.createSession({
    email: "integration-logo-delete@example.com",
  });
  const objectKey = await seedOrganizationLogo({ env, organizationId: session.organizationId });

  const response = await env.controlPlaneApi.http.fetch("/v1/organization/logo", {
    method: "DELETE",
    headers: {
      cookie: session.cookie,
    },
  });

  expect(response.status).toBe(204);
  await expect(env.objectStore.headObject(objectKey)).rejects.toMatchObject({
    name: "NotFound",
  });
});
```

The helper names explain the setup; the test body still shows the behavior being
verified.

## Reviewability Checklist

An `integration` test should make the behavior under review obvious without
requiring the reviewer to mentally execute harness setup.

Use this checklist when writing or reviewing a test:

- The `createIntegrationTest(...)` declaration makes the selected Mistle
  services and optional `extraInfra` obvious.
- The test name states the domain behavior, not the route shape or helper
  implementation.
- The test body reads as arrange, act, assert.
- Helpers hide protocol mechanics, repetitive seeding, polling, and cleanup;
  they do not hide the behavior being asserted.
- Seeded ids and names are meaningful enough to connect setup to assertions.
- Direct database writes are domain setup or observable-state assertions, not a
  shortcut around the behavior under test.
- Assertions prove observable behavior: HTTP response, persisted state, emitted
  object, workflow result, email delivery, or UI-visible output.
- Polling has a bounded timeout and a domain reason.
- `describe.concurrent(...)` is used when scenarios are independent; sequential
  files explain the shared state or exclusive resource.
- `__dangerouslyIsolatedServices` includes a concrete lifecycle reason, such as
  restarting a service process.

For example, this shape is easy to review because the service selection,
scenario setup, user action, and persisted outcome are visible:

```ts
/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { createIntegrationTest } from "@mistle/test-harness/integration";
import type { IntegrationTestEnvironment } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("sandbox profiles create integration", () => {
  it("creates a sandbox profile in the authenticated user's organization", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-profile-create@example.com",
      organizationName: "Profile Create Integration",
    });

    const response = await env.controlPlaneApi.http.fetch("/v1/sandbox/profiles", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: session.cookie,
      },
      body: JSON.stringify({
        displayName: "Reviewable Profile",
      }),
    });

    expect(response.status).toBe(201);
    const profileId = readCreatedProfileId(await response.json());
    await expectProfile(env, {
      profileId,
      organizationId: session.organizationId,
      displayName: "Reviewable Profile",
    });
  });
});

function readCreatedProfileId(value: unknown): string {
  if (!isRecord(value) || typeof value["id"] !== "string") {
    throw new Error("Expected sandbox profile creation response to include id.");
  }

  return value["id"];
}

async function expectProfile(
  env: IntegrationTestEnvironment,
  expected: {
    profileId: string;
    organizationId: string;
    displayName: string;
  },
): Promise<void> {
  const persisted = await env.controlPlaneDb.query.sandboxProfiles.findFirst({
    columns: {
      id: true,
      organizationId: true,
      displayName: true,
    },
    where: (table, { eq }) => eq(table.id, expected.profileId),
  });

  expect(persisted).toEqual(expected);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
```

The helper functions are local and mechanical. The test still shows the selected
service, authenticated user, API request, response assertion, and persisted
state assertion.

## Files And Commands

App integration tests live in `apps/*/integration/`.

Each app package with integration tests should expose:

- `vitest.integration.config.ts`
- `test:integration`

Run app and package integration tests from the repo root:

```bash
pnpm test:integration
```

The root command uses one integration runner session across all selected
projects, so pooled physical infrastructure and pooled services can be reused.

Run one package through the same root runner:

```bash
pnpm test:integration -- --project @mistle/data-plane-gateway
```

Run one file through the same root runner when pooling or timing behavior
matters:

```bash
pnpm test:integration -- --project @mistle/data-plane-gateway integration/gateway-restart.integration.test.ts
```

Detailed setup timing is opt-in:

```bash
MISTLE_TEST_TIMING=1 pnpm test:integration
```

For targeted single-file debugging, use direct package Vitest execution:

```bash
pnpm --filter @mistle/data-plane-gateway exec vitest run -c vitest.integration.config.ts integration/gateway-restart.integration.test.ts
```

Direct package Vitest execution is useful for tight local debugging, but it is
not the canonical way to measure full-suite pooling or timing behavior.

## Migrating Legacy Patterns

Do not revive old per-file fixtures, bespoke Testcontainers setup, or direct
in-process app runtimes. First identify the behavior being asserted, then choose
the production entrypoint that best exercises that behavior.

When replacing old scaffolding:

- Preserve observable behavior, not old setup mechanics.
- Use `createIntegrationTest(...)`; do not copy legacy per-file containers,
  bespoke registries, or direct service bootstrapping.
- Select only the services the scenario intentionally exercises.
- Use `extraInfra` for optional dependencies such as `mailpit`, `otlp`, or
  `seaweedfs`.
- Use `env.auth`, `env.*Db`, `env.*Tables`, service handles, and reusable
  clients instead of app-local setup wrappers.
- Prefer `describe.concurrent(...)` and make data unique enough for concurrent
  execution.
- Keep lower-level assertions focused on persisted state, emitted objects, HTTP
  responses, workflow results, or other observable outcomes.

## Harness Author API

Most application developers should not need this section. Use it when adding or
changing harness support for a service.

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

`startTestEnvironment(...)` starts only the selected services. Service
references affect ordering and wiring among selected services; they must not
auto-start hidden dependencies.

```ts
const environment = await startTestEnvironment({
  registry,
  services: [{ service: "control-plane-api", mode: "runtime" }],
});
```

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

## Pooling And Cleanup

`env.stop()` releases the environment's leases:

- logical infra for that environment is cleaned up;
- physical infra stays alive while other leases still use it;
- pooled services stay alive while other leases still use them;
- isolated services stop with the environment.

`createIntegrationTest(...)` calls cleanup from a fixture `finally` block. If you
use `startTestEnvironment(...)` directly while implementing harness support, call
`environment.stop()` from your own `finally` block. Service handles close
harness-managed HTTP clients during cleanup, which avoids unbounded connection
churn in large parallel suites.

Tests should not hand-roll Testcontainers resources when the harness can model
the dependency. If a service needs new infrastructure, add it to the harness
service definition.

## What Not To Do

- Do not reintroduce legacy per-file fixtures or bespoke app launchers.
- Do not make app developers define registries, provisioners, or service
  launchers in ordinary test files.
- Do not expose many fixture fields when one `env` object is enough.
- Do not add exported helpers for one app's current wiring.
- Do not use Docker mode as the default proof for lightweight integration
  tests.
- Do not make service references auto-start hidden dependencies.
