# @mistle/sandbox

Provider-agnostic sandbox lifecycle package used by Mistle services.

Current scope:

- create and delete provider-backed durable volumes
- start a sandbox from an image handle
- resume a sandbox against existing provider-managed state
- stop a running sandbox without destroying its durable volume state
- destroy a sandbox runtime
- apply runtime startup payloads through provider-scoped runtime control

Currently implemented providers:

- Docker
- Modal

Provider-specific documentation lives with each provider:

- [`src/providers/modal/README.md`](./src/providers/modal/README.md)
- [`src/providers/docker/README.md`](./src/providers/docker/README.md)

Provider-scoped integration tests live under `integration/<provider>/` (for example `integration/modal/`).
Integration test execution is gated at package level with `MISTLE_TEST_SANDBOX_INTEGRATION=1`, then narrowed by provider using `MISTLE_TEST_SANDBOX_INTEGRATION_PROVIDERS` (CSV). For example:

```bash
MISTLE_TEST_SANDBOX_INTEGRATION=1 MISTLE_TEST_SANDBOX_INTEGRATION_PROVIDERS=modal pnpm --filter @mistle/sandbox test:integration
```

Docker integration tests default `MISTLE_SANDBOX_DOCKER_SOCKET_PATH` to `/var/run/docker.sock`. Set it explicitly if your Docker socket is elsewhere:

```bash
MISTLE_TEST_SANDBOX_INTEGRATION=1 MISTLE_TEST_SANDBOX_INTEGRATION_PROVIDERS=docker pnpm --filter @mistle/sandbox test:integration
```

List of valid providers for MISTLE_TEST_SANDBOX_INTEGRATION_PROVIDERS:

- `modal`
- `docker`

Unknown provider names fail fast during integration config parsing.

## Public API

The package root exports:

- `SandboxProvider`
- `SandboxRuntimeProvider`
- `SandboxVolumeProvider`
- `SandboxImageHandle`
- `SandboxVolumeHandleV1`
- `SandboxVolumeMountV1`
- `SandboxHandle`
- `SandboxRuntimeControl`
- `CreateVolumeRequestV1`
- `DeleteVolumeRequestV1`
- `SandboxStartRequest`
- `SandboxResumeRequestV1`
- `SandboxStopRequest`
- `SandboxDestroyRequest`
- `SandboxAdapter`
- `SandboxError`
- `SandboxConfigurationError`
- `SandboxProviderNotImplementedError`
- `createSandboxAdapter`
- `createSandboxRuntimeControl`

`createSandboxAdapter` and `createSandboxRuntimeControl` are the main entrypoints.

```ts
import {
  createSandboxAdapter,
  createSandboxRuntimeControl,
  type SandboxImageHandle,
} from "@mistle/sandbox";

// See provider README for provider-specific configuration shape.
const providerConfig = { provider: "..." };
const adapter = createSandboxAdapter(providerConfig);
const runtimeControl = createSandboxRuntimeControl(providerConfig);

const baseImage: SandboxImageHandle = {
  provider: providerConfig.provider,
  imageId: "im-abc123",
  createdAt: new Date().toISOString(),
};

const volume = await adapter.createVolume({});

const sandbox = await adapter.start({
  image: baseImage,
  mounts: [
    {
      volume,
      mountPath: "/home/sandbox",
    },
  ],
});

await runtimeControl.applyStartup({
  id: sandbox.id,
  payload: Buffer.from("bootstrap payload\n", "utf8"),
});

await adapter.stop({ id: sandbox.id });
const resumedSandbox = await adapter.resume({
  image: baseImage,
  mounts: [
    {
      volume,
      mountPath: "/home/sandbox",
    },
  ],
  id: sandbox.id,
});
await adapter.destroy({ id: resumedSandbox.id });
await adapter.deleteVolume({ volumeId: volume.volumeId });
await runtimeControl.close();
```

## Usage Notes

- Sandbox image handles describe the provider image passed to `start({ image })`.
- Sandbox volume handles are opaque provider-managed volume references returned by `createVolume({})`.
- `SandboxStartRequest.mounts` attaches provider-backed volumes at the requested mount paths.
- `SandboxResumeRequestV1` resumes provider compute against existing mounts using a previous sandbox `id`.
- `SandboxRuntimeControl.applyStartup({ id, payload })` delivers runtime startup bytes to an already-running sandbox using provider-native control paths.
- `SandboxRuntimeControl.close()` releases provider client resources held by runtime control.
- Operations may throw `SandboxError` subclasses. Configuration failures throw `SandboxConfigurationError`.

## Responsibility Boundary

`@mistle/sandbox` is responsible only for sandbox lifecycle operations exposed by the adapter interface:

- create and delete provider-backed volumes
- start a sandbox from an image handle
- resume a sandbox runtime
- stop a sandbox runtime
- destroy a sandbox runtime
- apply runtime startup payloads through a separate runtime-control interface

It is not responsible for provisioning or managing provider infrastructure/resources. For current and future adapters (for example Modal, Docker, Kubernetes), platform concerns such as autoscaling, cluster/node lifecycle, scheduling policy, capacity management, and other underlying resource orchestration are out of scope for this package.

## Adding a New Provider

Use the current Modal provider as the reference implementation.

1. Add provider identity in `src/types.ts`.
2. Create `src/providers/<provider>/schemas.ts` and define all config/request schemas with Zod.
3. Create `src/providers/<provider>/config.ts` to expose validated provider config.
4. Implement `src/providers/<provider>/client.ts` for raw SDK/API calls.
5. Add provider error mapping in `src/providers/<provider>/client-errors.ts`.
6. Implement `src/providers/<provider>/adapter.ts` that satisfies `SandboxAdapter`.
7. Implement `src/providers/<provider>/runtime-control.ts` that satisfies `SandboxRuntimeControl`.
8. Create `src/providers/<provider>/index.ts` with both `create<Provider>Adapter(...)` and `create<Provider>RuntimeControl(...)` constructors.
9. Wire the provider into both `createSandboxAdapter` and `createSandboxRuntimeControl` in `src/factory.ts`.
10. Add unit tests next to each provider module, including config, errors, factory wiring, adapter behavior, and runtime-control construction.
11. Add provider integration tests in `integration/<provider>/` (for example `integration/modal/modal-adapter.integration.test.ts`).
12. Integration tests must cover the provider lifecycle surface: `createVolume`, `deleteVolume`, `start`, `resume`, `stop`, and `destroy`, plus runtime-control behavior for startup payload application and any provider-specific stdin/filesystem interactions the package exposes.

Design expectations:

- validate all external inputs with Zod
- fail fast on missing config/state
- keep provider-specific concerns inside `src/providers/<provider>`
- return provider-agnostic handles from the `SandboxAdapter` boundary
- keep provider-specific runtime control inside `src/providers/<provider>/runtime-control.ts`
