# @mistle/sandbox

Provider-agnostic sandbox compute, storage-attachment, and runtime-control package used by Mistle services.

Implemented providers:

- Docker
- E2B

Provider-specific documentation lives with each provider:

- [`src/providers/docker/README.md`](./src/providers/docker/README.md)
- [`src/providers/e2b/README.md`](./src/providers/e2b/README.md)

Persistent sandbox behavior across data-plane workflows is documented in [`docs/experimental/persistent-sandboxes.md`](../../docs/experimental/persistent-sandboxes.md).

## What This Package Owns

`@mistle/sandbox` owns the provider boundary for sandbox compute and in-provider runtime actions:

- prepare provider-specific storage state before compute start
- start compute from a provider image or snapshot handle
- inspect compute and normalize provider lifecycle state
- resume, stop, and destroy provider compute
- capture a new provider image or snapshot handle from a running sandbox
- attach and clean up provider-mounted persistent storage
- initialize or resume the in-sandbox `sandboxd` runtime
- read `sandboxd` init/resume operation logs for startup diagnostics

It does not decide whether a sandbox instance is ephemeral or persistent, provision durable storage records, choose organization storage settings, compile runtime plans, mint tunnel tokens, or manage provider platform infrastructure such as autoscaling, cluster/node lifecycle, scheduling policy, and capacity management. Those decisions live in the data-plane/control-plane application layers. This package receives already-resolved provider config, image handles, runtime payloads, and storage attachment handles.

## Public API

The main entrypoints are:

- `createSandboxAdapter(...)`
- `createSandboxRuntimeControl(...)`

`SandboxAdapter` exposes provider compute and storage attachment operations:

- `prepareStorageForStart(request)`
- `start(request)`
- `inspect(request)`
- `resume(request)`
- `captureSnapshot(request)`
- `attachStorage(request)`
- `cleanupStorage(request)`
- `stop(request)`
- `destroy(request)`

`SandboxRuntimeControl` exposes runtime-daemon operations:

- `init(request)`
- `resume(request)`
- `readOperationLog(request)`
- `close()`

The package root also exports provider ids, request/result types, storage backend/layout/lifecycle types, runtime env helpers, and sandbox error classes from `src/types.ts`, `src/runtime-env.ts`, and `src/errors.ts`.

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

## Storage Contract

Persistent storage provisioning is outside this package. Data-plane worker storage backend adapters create or resolve durable storage and then pass provider attachment payloads into `@mistle/sandbox`.

Supported storage backends:

| Runtime provider | Storage backend |
| ---------------- | --------------- |
| `docker`         | `docker_volume` |
| `e2b`            | `archil`        |

The shared persistent layout is:

| Storage path | Sandbox path |
| ------------ | ------------ |
| `root`       | `/root`      |
| `etc/codex`  | `/etc/codex` |

Start and resume storage flow:

1. Data-plane chooses persistence mode and provisions/loads durable storage.
2. Data-plane calls `prepareStorageForStart(...)` before compute start.
3. Data-plane calls `start(...)` with the returned `storagePreparation`.
4. Data-plane calls `attachStorage(...)` before runtime `init(...)`.
5. Resume calls `resume(...)`, then `attachStorage(...)`, then runtime `resume(...)`.
6. Stop and destroy paths call `cleanupStorage(...)` before and after compute teardown; adapters may no-op when no provider cleanup is currently required.

Provider differences:

- Docker needs storage preparation before `start(...)` so volume subpaths can be created before container mounts are configured. Docker storage attach and cleanup are currently no-ops because the mounts are part of container creation.
- E2B returns empty start preparation, starts compute first, then attaches Archil storage from inside the sandbox with root commands.

## Snapshots

`captureSnapshot({ id })` returns a provider image handle that can later be passed to `start({ image })` for the same provider. Docker implements this with `container.commit({ pause: true })`. E2B implements this with `sandbox.createSnapshot()`.

Snapshots preserve a prepared provider image. They are separate from persistent sandbox storage, which preserves selected per-instance filesystem paths across compute replacement.

## Data-Plane Call Paths

The package is used by the data-plane API and worker through provider factories in:

- `apps/data-plane-api/src/sandbox/adapter.ts`
- `apps/data-plane-worker/openworkflow/core/sandbox-runtime-adapter.ts`

Current high-level flows:

- start workflow: ensure sandbox row, provision storage when persistent, `prepareStorageForStart`, `start`, `attachStorage`, persist provider metadata, runtime `init`, wait for readiness
- resume workflow: mark starting, try provider `resume`, attach storage, runtime `resume`, wait for readiness; persistent sandboxes may replace compute when provider state is missing
- stop/destroy workflows: call storage cleanup around provider compute teardown
- snapshot materialization: start an ephemeral setup sandbox, initialize runtime, capture a snapshot handle, then destroy compute
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

Unknown provider names fail fast during integration config parsing.

## Adding a New Provider

Use the current Docker and E2B providers as reference implementations; neither provider is a complete template on its own because their storage models differ.

1. Add provider identity in `src/types.ts`.
2. Create `src/providers/<provider>/schemas.ts` and define config/request schemas with Zod.
3. Create `src/providers/<provider>/config.ts` to expose validated provider config.
4. Implement `src/providers/<provider>/client.ts` for raw SDK/API calls.
5. Add provider error mapping in `src/providers/<provider>/client-errors.ts`.
6. Implement `src/providers/<provider>/adapter.ts` for the complete `SandboxAdapter` surface: storage preparation, start, inspect, resume, snapshot capture, storage attach, storage cleanup, stop, and destroy.
7. Implement `src/providers/<provider>/runtime-control.ts` for the complete `SandboxRuntimeControl` surface: init, resume, egress refresh, operation-log reads, and close.
8. Create `src/providers/<provider>/index.ts` with both `create<Provider>Adapter(...)` and `create<Provider>RuntimeControl(...)` constructors.
9. Wire the provider into both `createSandboxAdapter` and `createSandboxRuntimeControl` in `src/factory.ts`.
10. Decide which persistent storage backend combinations the provider supports and fail fast for unsupported storage payloads.
11. Add unit tests next to provider modules, including config, errors, factory wiring, adapter behavior, storage commands, and runtime-control construction.
12. Add provider integration tests in `integration/<provider>/`.

Integration tests should cover the provider lifecycle surface, snapshot capture, runtime-control init/resume behavior, operation-log reads, and any provider-specific storage behavior exposed by the package.

Design expectations:

- validate external inputs with Zod
- fail fast on missing config, invalid provider/image combinations, and unsupported storage payloads
- keep provider-specific concerns inside `src/providers/<provider>`
- return provider-agnostic handles from the `SandboxAdapter` boundary
- keep provider-specific runtime control inside `src/providers/<provider>/runtime-control.ts`
