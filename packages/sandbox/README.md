# @mistle/sandbox

Provider-agnostic sandbox lifecycle package used by Mistle services.

Current scope:

- start a sandbox from a shared OCI base image handle
- resume a sandbox against existing provider-managed state
- stop a running sandbox
- destroy a sandbox runtime
- apply runtime startup payloads through provider-scoped runtime control

Currently implemented providers:

- Docker
- E2B

Provider-specific documentation lives with each provider:

- [`src/providers/docker/README.md`](./src/providers/docker/README.md)
- [`src/providers/e2b/README.md`](./src/providers/e2b/README.md)

Provider-scoped integration tests live under `integration/<provider>/` (for example `integration/docker/`).
Integration test execution is gated at package level with `MISTLE_TEST_SANDBOX_INTEGRATION=1`, then narrowed by provider using `MISTLE_TEST_SANDBOX_INTEGRATION_PROVIDERS` (CSV). For example:

```bash
MISTLE_TEST_SANDBOX_INTEGRATION=1 MISTLE_TEST_SANDBOX_INTEGRATION_PROVIDERS=docker pnpm --filter @mistle/sandbox test:integration
```

Docker integration tests default `MISTLE_SANDBOX_DOCKER_SOCKET_PATH` to `/var/run/docker.sock`. Set it explicitly if your Docker socket is elsewhere.

E2B integration tests require `E2B_API_KEY` and default the shared base image to `ghcr.io/mistlehq/sandbox-base:latest`:

```bash
E2B_API_KEY=... MISTLE_TEST_SANDBOX_INTEGRATION=1 MISTLE_TEST_SANDBOX_INTEGRATION_PROVIDERS=e2b pnpm --filter @mistle/sandbox test:integration
```

List of valid providers for MISTLE_TEST_SANDBOX_INTEGRATION_PROVIDERS:

- `docker`
- `e2b`

Unknown provider names fail fast during integration config parsing.

## Public API

The package root exports:

- `SandboxProvider`
- `SandboxRuntimeProvider`
- `SandboxImageHandle`
- `SandboxHandle`
- `SandboxRuntimeControl`
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

const sandbox = await adapter.start({
  image: baseImage,
});

await runtimeControl.applyStartup({
  id: sandbox.id,
  payload: Buffer.from("bootstrap payload\n", "utf8"),
});

await adapter.stop({ id: sandbox.id });
const resumedSandbox = await adapter.resume({
  id: sandbox.id,
});
await adapter.destroy({ id: resumedSandbox.id });
await runtimeControl.close();
```

## Usage Notes

- Sandbox image handles describe the provider image passed to `start({ image })`.
- `SandboxResumeRequestV1` resumes provider compute against existing sandbox state using a previous sandbox `id`.
- `SandboxRuntimeControl.applyStartup({ id, payload })` delivers runtime startup bytes to an already-running sandbox using provider-native control paths.
- `SandboxRuntimeControl.close()` releases provider client resources held by runtime control.
- E2B uses the same shared OCI base image reference but resolves provider-native templates internally.
- `SandboxResumeRequestV1.id` is the durable provider-side sandbox identity returned by `start`.
- Operations may throw `SandboxError` subclasses. Configuration failures throw `SandboxConfigurationError`.

## Responsibility Boundary

`@mistle/sandbox` is responsible only for sandbox lifecycle operations exposed by the adapter interface:

- start a sandbox from an image handle
- resume a sandbox runtime
- stop a sandbox runtime
- destroy a sandbox runtime
- apply runtime startup payloads through a separate runtime-control interface

It is not responsible for provisioning or managing provider infrastructure/resources. For current and future adapters (for example Docker, E2B, Kubernetes), platform concerns such as autoscaling, cluster/node lifecycle, scheduling policy, capacity management, and other underlying resource orchestration are out of scope for this package.

## Adding a New Provider

Use the current Docker provider as the reference implementation.

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
11. Add provider integration tests in `integration/<provider>/` (for example `integration/docker/docker-adapter.integration.test.ts`).
12. Integration tests must cover the provider lifecycle surface: `start`, `resume`, `stop`, and `destroy`, plus runtime-control behavior for startup payload application and any provider-specific stdin/filesystem interactions the package exposes.

Design expectations:

- validate all external inputs with Zod
- fail fast on missing config/state
- keep provider-specific concerns inside `src/providers/<provider>`
- return provider-agnostic handles from the `SandboxAdapter` boundary
- keep provider-specific runtime control inside `src/providers/<provider>/runtime-control.ts`
