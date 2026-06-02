# @mistle/sandbox

Provider-agnostic sandbox compute and runtime-control package used by Mistle services.

Implemented providers:

- Docker
- E2B
- Tensorlake

Provider-specific documentation lives with providers that have dedicated README files:

- [`src/providers/docker/README.md`](./src/providers/docker/README.md)
- [`src/providers/e2b/README.md`](./src/providers/e2b/README.md)

## What This Package Owns

`@mistle/sandbox` owns the provider boundary for sandbox compute and in-provider runtime actions:

- prepare provider-specific image/template state before compute start
- start compute from a provider image or snapshot handle
- inspect compute and normalize provider lifecycle state
- resume, stop, and destroy provider compute
- capture a new provider image or snapshot handle from a running sandbox
- initialize or resume the in-sandbox `sandboxd` runtime
- read `sandboxd` version for runtime visibility
- read `sandboxd` init/resume operation logs for startup diagnostics

It does not compile runtime plans, mint tunnel tokens, or manage provider platform infrastructure such as autoscaling, cluster/node lifecycle, scheduling policy, and capacity management. Those decisions live in the data-plane/control-plane application layers. This package receives already-resolved provider config, image handles, and runtime payloads.

## Public API

The main entrypoints are:

- `createSandboxAdapter(...)`
- `createSandboxRuntimeControl(...)`

`SandboxAdapter` exposes provider compute operations:

- `prepareImage(request)`
- `start(request)`
- `inspect(request)`
- `resume(request)`
- `captureSnapshot(request)`
- `stop(request)`
- `destroy(request)`

`SandboxRuntimeControl` exposes runtime-daemon operations:

- `readSandboxdVersion(request)`
- `init(request)`
- `resume(request)`
- `readOperationLog(request)`
- `close()`

The package root also exports provider ids, request/result types, runtime env helpers, and sandbox error classes from `src/types.ts`, `src/runtime-env.ts`, and `src/errors.ts`.

```ts
import {
  SandboxProvider,
  createSandboxAdapter,
  createSandboxRuntimeControl,
  type SandboxImageHandle,
} from "@mistle/sandbox";

const providerConfig = {
  provider: SandboxProvider.DOCKER,
  docker: {
    socketPath: "/var/run/docker.sock",
  },
};

const adapter = createSandboxAdapter(providerConfig);
const runtimeControl = createSandboxRuntimeControl(providerConfig);

const image: SandboxImageHandle = {
  provider: SandboxProvider.DOCKER,
  imageId: "ghcr.io/mistlehq/sandbox-base:latest",
  createdAt: new Date().toISOString(),
};

const sandbox = await adapter.start({
  image,
  env: {
    SANDBOX_RUNTIME_SANDBOX_INSTANCE_ID: "sbi_...",
  },
});

await runtimeControl.init({
  id: sandbox.id,
  payload: new TextEncoder().encode("{}\n"),
});

const inspection = await adapter.inspect({ id: sandbox.id });
const snapshot = await adapter.captureSnapshot({ id: sandbox.id });

await adapter.stop({ id: sandbox.id });
await adapter.resume({ id: sandbox.id });
await adapter.destroy({ id: sandbox.id });
await runtimeControl.close();

void inspection;
void snapshot;
```

Provider config is intentionally provider-scoped. `createSandboxAdapter({ provider: "docker" })` fails unless `docker` config is provided, and `createSandboxAdapter({ provider: "e2b" })` fails unless `e2b` config is provided.

## Runtime Env

Official providers inject required runtime env through `withRequiredSandboxRuntimeEnv(...)` before compute or daemon startup. `SANDBOX_RUNTIME_LISTEN_ADDR` is reserved and must remain `127.0.0.1:8090`; callers may pass additional runtime env values for application-specific runtime behavior.

## Inspect Semantics

`inspect({ id })` returns provider-neutral lifecycle fields plus the raw provider payload:

- `state`: coarse shared state, currently `running` or `stopped`
- `disposition`: policy-oriented state, currently `active`, `resumable_stopped`, or `terminal_stopped`
- `createdAt`, `startedAt`, `endedAt`
- `raw`: the provider inspect payload for debugging and observability

Application lifecycle policy should prefer `state` and `disposition` over provider-specific `raw` fields. Missing provider compute is represented as `SandboxResourceNotFoundError` when adapters can identify the provider not-found condition.

## Snapshots

`captureSnapshot({ id })` returns a provider image handle that can later be passed to `start({ image })` for the same provider. Docker implements this with `container.commit({ pause: true })`. E2B implements this with `sandbox.createSnapshot()`.

Snapshots preserve a prepared provider image. Individual sandbox instances keep their own disk state across ordinary stop/start cycles through the provider runtime.

## Data-Plane Call Paths

The package is used by the data-plane API and worker through provider factories in:

- `apps/data-plane-api/src/sandbox/adapter.ts`
- `apps/data-plane-worker/openworkflow/core/sandbox-runtime-adapter.ts`

Current high-level flows:

- start workflow: ensure sandbox row, `prepareImage`, `start`, persist provider metadata, runtime `init`, wait for readiness
- resume workflow: mark starting, try provider `resume`, runtime `resume`, wait for readiness
- stop/destroy workflows: call provider compute teardown
- snapshot materialization: start a setup sandbox, initialize runtime, capture a snapshot handle, then destroy compute
- startup diagnostics: worker reads provider operation logs with `readOperationLog({ operation: "init" | "resume" })` after init/resume failures

## Integration Tests

Provider-scoped integration tests live under `integration/<provider>/` (for example `integration/docker/`).

Integration test execution is gated at package level with `MISTLE_TEST_SANDBOX_INTEGRATION=1`, then narrowed by provider using `MISTLE_TEST_SANDBOX_INTEGRATION_PROVIDERS` as a CSV:

```bash
MISTLE_TEST_SANDBOX_INTEGRATION=1 MISTLE_TEST_SANDBOX_INTEGRATION_PROVIDERS=docker pnpm --filter @mistle/sandbox test:integration
```

Docker integration tests default `MISTLE_SANDBOX_DOCKER_SOCKET_PATH` to `/var/run/docker.sock`. Set it explicitly if your Docker socket is elsewhere.

E2B integration tests require `E2B_API_KEY`. They use `MISTLE_SANDBOX_E2B_BASE_IMAGE` when set; otherwise they resolve the latest published sandbox base image through `@mistle/config`.

```bash
E2B_API_KEY=... MISTLE_TEST_SANDBOX_INTEGRATION=1 MISTLE_TEST_SANDBOX_INTEGRATION_PROVIDERS=e2b pnpm --filter @mistle/sandbox test:integration
```

Valid providers for `MISTLE_TEST_SANDBOX_INTEGRATION_PROVIDERS`:

- `docker`
- `e2b`
- `tensorlake`

Unknown provider names fail fast during integration config parsing.

## Adding a New Provider

Use the current Docker, E2B, and Tensorlake providers as reference implementations.

1. Add provider identity in `src/types.ts`.
2. Create `src/providers/<provider>/schemas.ts` and define config/request schemas with Zod.
3. Create `src/providers/<provider>/config.ts` to expose validated provider config.
4. Implement `src/providers/<provider>/client.ts` for raw SDK/API calls.
5. Add provider error mapping in `src/providers/<provider>/client-errors.ts`.
6. Implement `src/providers/<provider>/adapter.ts` for the complete `SandboxAdapter` surface: image preparation, start, inspect, resume, snapshot capture, stop, and destroy.
7. Implement `src/providers/<provider>/runtime-control.ts` for the complete `SandboxRuntimeControl` surface: sandboxd version reads, init, resume, operation-log reads, and close.
8. Create `src/providers/<provider>/index.ts` with both `create<Provider>Adapter(...)` and `create<Provider>RuntimeControl(...)` constructors.
9. Wire the provider into both `createSandboxAdapter` and `createSandboxRuntimeControl` in `src/factory.ts`.
10. Add unit tests next to provider modules, including config, errors, factory wiring, adapter behavior, and runtime-control construction.
11. Add provider integration tests in `integration/<provider>/`.

Integration tests should cover the provider lifecycle surface, snapshot capture, runtime-control init/resume behavior, and operation-log reads.

Design expectations:

- validate external inputs with Zod
- fail fast on missing config and invalid provider/image combinations
- keep provider-specific concerns inside `src/providers/<provider>`
- return provider-agnostic handles from the `SandboxAdapter` boundary
- keep provider-specific runtime control inside `src/providers/<provider>/runtime-control.ts`
