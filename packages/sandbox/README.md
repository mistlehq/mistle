# @mistle/sandbox

Provider-agnostic sandbox lifecycle package used by Mistle services.

Current scope:

- start a sandbox from an image handle
- snapshot a running sandbox to a new image handle
- stop a running sandbox

A single provider is currently implemented: Modal.

Provider-specific documentation lives with each provider:

- [`src/providers/modal/README.md`](./src/providers/modal/README.md)

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
9. Add tests next to each provider module (config, errors, factory wiring, and adapter behavior).

Design expectations:

- validate all external inputs with Zod
- fail fast on missing config/state
- keep provider-specific concerns inside `src/providers/<provider>`
- return provider-agnostic handles from the `SandboxAdapter` boundary
