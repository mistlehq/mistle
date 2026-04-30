# Environment Harness

This module has two layers:

- the generic orchestration layer, used by `createServiceRegistry`
- the concrete Mistle service catalog, exposed as `createTestRegistry`

The goal is to make reference-bearing tests cheap enough for the CI hot path:

- Mistle apps run through `runtime`, `process`, or `docker` launchers.
- External infrastructure can still use real Testcontainers-backed services.
- Infrastructure is deduped by requirement id.
- Services start in reference layers so independent services can start in parallel.
- Cleanup runs services first, then infrastructure.

## Concepts

### Service Definition

A service definition describes one Mistle service from the harness point of view:

- `id`: stable service name, such as `control-plane-api`.
- `infra`: logical infrastructure requirements.
- `serviceReferences`: optional peer services this service can use when the
  test selects them. References do not cause services to start automatically.
- `supportedModes`: supported launch modes for that service.
- `healthCheck`: liveness/readiness probe used before a pooled service is reused.
- `start`: launcher implementation for the requested mode.

Service definitions should use production entrypoints and production protocols. HTTP services should return an `endpoints.http` handle. Background workers can return no HTTP endpoints and expose runtime metadata such as `containerId` for health checks. The harness may import runtime factories in test composition code, but application code should not import other applications.

### Service Registry

A service registry is the caller-facing layer above service definitions. It is defined once for a set of launchable services, then tests select services by type-safe id strings and modes:

```ts
const registry = createServiceRegistry({
  services: {
    "control-plane-api": controlPlaneApi,
    "control-plane-worker": controlPlaneWorker,
  },
});
```

Registry keys must match each service definition's `id`. That keeps the string requested by `startTestEnvironment` and the service identity used by reference edges aligned.

Service references only affect ordering among selected services. If
`data-plane-api` references `control-plane-api` but a test only selects
`data-plane-api`, the environment starts only `data-plane-api`. The launcher
should wire an explicit dead URL for the unselected peer. If the test selects
both services, the planner starts `control-plane-api` first so `data-plane-api`
can receive the real endpoint.

### Infrastructure Requirement

An infrastructure requirement is logical, not necessarily one container. For example, three Postgres database requirements can be served by one shared Postgres container with three isolated databases.

Requirements are deduped by `id`. If two services declare the same infra `id`, they must agree on `kind` and use the same provisioner instance.

### Infrastructure Provisioner

A provisioner owns one infrastructure `kind`, such as `postgres-database`, `mailpit`, or `valkey`. It receives all requirements for that kind at once so it can dedupe physical resources while preserving logical isolation.

### Launch Modes

Test environments support these Mistle app launch modes:

- `runtime`: import and start the production runtime factory in the Vitest process.
- `process`: spawn the production service entrypoint as a local OS process.
- `docker`: start the service through a containerized launcher.

This generic layer does not decide which mode belongs to which test class. Higher-level environment factories can restrict modes later if needed.

## Example

```ts
const postgresDatabase = {
  id: "postgres.control-plane",
  kind: "postgres-database",
  provisioner: postgresDatabaseProvisioner,
};

const controlPlaneApi: TestServiceDefinition = {
  id: "control-plane-api",
  infra: [postgresDatabase],
  serviceReferences: [],
  supportedModes: ["runtime", "process"],
  healthCheck: checkControlPlaneApiHealth,
  start: startControlPlaneApi,
};

const controlPlaneWorker: TestServiceDefinition = {
  id: "control-plane-worker",
  infra: [postgresDatabase],
  serviceReferences: ["control-plane-api"],
  supportedModes: ["runtime", "process"],
  healthCheck: checkControlPlaneWorkerHealth,
  start: startControlPlaneWorker,
};

const registry = createServiceRegistry({
  services: {
    "control-plane-api": controlPlaneApi,
    "control-plane-worker": controlPlaneWorker,
  },
});

const env = await startTestEnvironment({
  registry,
  services: [
    { service: "control-plane-api", mode: "runtime" },
    { service: "control-plane-worker", mode: "runtime" },
  ],
});

try {
  // Run test assertions against env.id, env.services, and env.infra.
} finally {
  await env.stop();
}
```

## Parallelism Model

Each environment has a unique id on `env.id`. Callers can provide an id when it must be known before scaffolding; otherwise `startTestEnvironment` generates one. Provisioners should use it when creating logical resources such as database names, workflow namespaces, Valkey prefixes, bucket names, temp directories, and log paths.

The harness intentionally passes all requirements for one infra kind to a single provisioner call. That lets the provisioner use one physical container while creating isolated logical resources for parallel test files.

`createServiceRegistry` pools custom services by default for the current runner session. The concrete Mistle `createTestRegistry` uses it underneath. Tests should normally lease existing services and use isolated logical data/resources underneath them. Service handles expose a harness-managed HTTP client so tests reuse bounded connection pools instead of opening new client connections for every assertion.

A test should only opt into a dedicated physical reference when it mutates the reference itself, such as restarting Postgres, changing Valkey process configuration, forcing a disk-full condition, or testing a network partition.

The escape hatch should be intentionally loud:

```ts
// Shape reserved for the concrete Mistle infra registry:
// createTestRegistry({
//   __dangerouslyDedicatedInfra: {
//     postgres: {
//       reason: "This test restarts Postgres and must not affect parallel tests.",
//     },
//   },
// });
```

The `reason` should be required so reviewers can distinguish real physical-infra tests from tests that should instead rely on normal logical isolation.

Tests that mutate a Mistle service process should opt out of service pooling for that service:

```ts
const registry = createTestRegistry({
  __dangerouslyIsolatedServices: {
    reason: "This test restarts the gateway process and must not affect parallel tests.",
    services: ["data-plane-gateway"],
  },
});
```

The default gateway registry backend should be Valkey-backed. Memory-backed registries are not a good fit for pooled service integration tests because they put test state inside the service process.

Cross-worker service pooling requires services to live outside the Vitest worker process. `process` and `docker` modes can be shared through runner-scoped metadata and health checks. Runtime-mode services can also be shared when their launcher uses the hosted runtime primitive, which starts the runtime in a coordinator-owned child process.

The root `pnpm test:integration` runner creates the runner pool session automatically. It sets `MISTLE_TEST_RUN_ID`, `MISTLE_TEST_COORDINATOR_DIR`, and `MISTLE_TEST_POOLING=1` before Vitest starts, then tears down pooled services after Vitest exits. Direct Vitest runs can still pass an explicit session to the lower-level primitives.

The runner service pool primitive coordinates this with a run id, a pool key, a lock directory, and a persisted service record:

```ts
const lease = await acquireRunnerServicePoolLease({
  runId: process.env.MISTLE_TEST_RUN_ID,
  key: "default/control-plane-api/process",
  start: startControlPlaneApiProcess,
  healthCheck: async (service) => {
    const http = service.endpoints.http;
    if (http === undefined) {
      throw new Error("control-plane-api did not expose an HTTP endpoint.");
    }

    const response = await fetch(new URL("/__healthz", http.hostBaseUrl));
    if (!response.ok) {
      throw new Error("control-plane-api is not healthy.");
    }
  },
});
```

If another worker has already started the same key and the health check passes, the coordinator returns the existing service runtime metadata instead of starting another service.

## Expected Mistle Registry Usage

Most integration tests should create the Mistle registry once at module scope, then call `startTestEnvironment` from each test. That lets a file share pooled physical infrastructure while every environment gets unique logical resources:

```ts
const registry = createTestRegistry();

it("creates an auth session", async () => {
  const env = await startTestEnvironment({
    registry,
    services: [{ service: "control-plane-api", mode: "docker" }],
  });

  try {
    const controlPlaneApi = env.services.get("control-plane-api");
    if (controlPlaneApi.http === undefined) {
      throw new Error("control-plane-api did not expose an HTTP client.");
    }

    await controlPlaneApi.http.fetch("/__healthz");
  } finally {
    await env.stop();
  }
});
```

When a file needs multiple services, it should still use the same registry and ask for the composed environment explicitly:

```ts
const registry = createTestRegistry();

it("processes work across control-plane services", async () => {
  const env = await startTestEnvironment({
    registry,
    services: [
      { service: "data-plane-api", mode: "docker" },
      { service: "data-plane-gateway", mode: "docker" },
    ],
  });

  try {
    // Exercise the API and observe worker-produced state.
  } finally {
    await env.stop();
  }
});
```

Shared test setup modules can export one registry when several files need the same service catalog and infra pool policy:

```ts
// apps/control-plane-api/integration/test-registry.ts
export const registry = createTestRegistry();
```

```ts
// apps/control-plane-api/integration/auth.integration.test.ts
import { registry } from "./test-registry.js";

it("verifies an email code", async () => {
  const env = await startTestEnvironment({
    registry,
    services: [{ service: "control-plane-api", mode: "docker" }],
  });

  try {
    // Exercise the auth flow.
  } finally {
    await env.stop();
  }
});
```

Dedicated physical infrastructure should stay rare and local to the test or file that needs it:

```ts
// Shape reserved for the concrete Mistle infra registry:
// const registry = createTestRegistry({
//   __dangerouslyDedicatedInfra: {
//     valkey: {
//       reason: "This test restarts Valkey to verify reconnect behavior.",
//     },
//   },
// });
```
