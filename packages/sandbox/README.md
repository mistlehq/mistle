# @mistle/sandbox

Provider-agnostic sandbox lifecycle package used by Mistle services.

Current scope:

- start a sandbox from an image handle
- snapshot a running sandbox to a new image handle
- stop a running sandbox

Currently implemented providers:

- Docker
- Modal

Provider-specific documentation lives with each provider:

- [`src/providers/modal/README.md`](./src/providers/modal/README.md)
- [`src/providers/docker/README.md`](./src/providers/docker/README.md)

Provider-scoped integration tests live under `integration/<provider>/` (for example `integration/modal/`).
Integration test execution is gated at package level with `MISTLE_SANDBOX_INTEGRATION=1`, then narrowed by provider using `MISTLE_SANDBOX_INTEGRATION_PROVIDERS` (CSV). For example:

```bash
MISTLE_SANDBOX_INTEGRATION=1 MISTLE_SANDBOX_INTEGRATION_PROVIDERS=modal pnpm --filter @mistle/sandbox test:integration
```

Docker integration tests also require `MISTLE_SANDBOX_DOCKER_SOCKET_PATH` (for example `/var/run/docker.sock`):

```bash
MISTLE_SANDBOX_INTEGRATION=1 MISTLE_SANDBOX_INTEGRATION_PROVIDERS=docker MISTLE_SANDBOX_DOCKER_SOCKET_PATH=/var/run/docker.sock pnpm --filter @mistle/sandbox test:integration
```

List of valid providers for MISTLE_SANDBOX_INTEGRATION_PROVIDERS:

- `modal`
- `docker`

Unknown provider names fail fast during integration config parsing.

## Public API

The package root exports:

- `SandboxProvider`
- `SandboxImageKind`
- `SandboxImageHandle`
- `SandboxHandle`
- `SandboxStartRequest`
- `SandboxSnapshotRequest`
- `SandboxStopRequest`
- `SandboxAdapter`
- `SandboxError`
- `SandboxConfigurationError`
- `SandboxProviderNotImplementedError`
- `createSandboxAdapter`

`createSandboxAdapter` is the main entrypoint.

```ts
import { createSandboxAdapter, SandboxImageKind, type SandboxImageHandle } from "@mistle/sandbox";

// See provider README for provider-specific configuration shape.
const providerConfig = { provider: "..." };
const adapter = createSandboxAdapter(providerConfig);

const baseImage: SandboxImageHandle = {
  provider: providerConfig.provider,
  imageId: "im-abc123",
  kind: SandboxImageKind.BASE,
  createdAt: new Date().toISOString(),
};

const sandbox = await adapter.start({ image: baseImage });

const snapshot = await adapter.snapshot({ sandboxId: sandbox.sandboxId });

await adapter.stop({ sandboxId: sandbox.sandboxId });
```

## Usage Notes

- Start and restore use the same semantic path: both are `start({ image })`.
- `image.kind` can be `base` or `snapshot`; provider implementations decide how they interpret it.
- Operations may throw `SandboxError` subclasses. Configuration failures throw `SandboxConfigurationError`.

## Responsibility Boundary

`@mistle/sandbox` is responsible only for sandbox lifecycle operations exposed by the adapter interface:

- start a sandbox from an image handle
- snapshot a running sandbox
- stop a sandbox

It is not responsible for provisioning or managing provider infrastructure/resources. For current and future adapters (for example Modal, Docker, Kubernetes), platform concerns such as autoscaling, cluster/node lifecycle, scheduling policy, capacity management, and other underlying resource orchestration are out of scope for this package.

## Adding a New Provider

Use the current Modal provider as the reference implementation.

1. Add provider identity in `src/types.ts`.
2. Create `src/providers/<provider>/schemas.ts` and define all config/request schemas with Zod.
3. Create `src/providers/<provider>/config.ts` to expose validated provider config.
4. Implement `src/providers/<provider>/client.ts` for raw SDK/API calls.
5. Add provider error mapping in `src/providers/<provider>/client-errors.ts`.
6. Implement `src/providers/<provider>/adapter.ts` that satisfies `SandboxAdapter`.
7. Create `src/providers/<provider>/index.ts` with a `create<Provider>Adapter(...)` constructor.
8. Wire the provider into `createSandboxAdapter` in `src/factory.ts`.
9. Add unit tests next to each provider module (config, errors, factory wiring, and adapter behavior).
10. Add provider integration tests in `integration/<provider>/` (for example `integration/modal/modal-adapter.integration.test.ts`).
11. Integration tests must cover the full lifecycle surface: `start` from a base image, mutate filesystem state, `snapshot`, `stop`, `start` from the snapshot image, verify restored filesystem state, and `stop` again.

Design expectations:

- validate all external inputs with Zod
- fail fast on missing config/state
- keep provider-specific concerns inside `src/providers/<provider>`
- return provider-agnostic handles from the `SandboxAdapter` boundary
