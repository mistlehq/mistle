# E2B Provider

E2B implementation for `@mistle/sandbox`.

## Config

`createSandboxAdapter({ provider: SandboxProvider.E2B, e2b: ... })` expects:

- `apiKey`: E2B API key
- `domain` (optional): override E2B domain when not using the default `e2b.app`

All config fields are validated with Zod and fail fast when invalid.

## Usage

```ts
import { createSandboxAdapter, SandboxProvider } from "@mistle/sandbox";

const adapter = createSandboxAdapter({
  provider: SandboxProvider.E2B,
  e2b: {
    apiKey: process.env.E2B_API_KEY ?? "",
  },
});
```

## Provider Behavior

- `start({ image, env })` uses `image.imageId` as the canonical OCI image reference.
- The provider resolves that image to a deterministic E2B template alias internally and builds it on demand when needed.
- `resume({ id })` reconnects to the same E2B sandbox id.
- `stop({ id })` pauses the sandbox.
- `destroy({ id })` kills the sandbox permanently.
- `createSandboxRuntimeControl(...).applyStartup({ id, payload })` runs `sandboxd apply-startup` as `root` through the E2B commands API.

## Error Surface

- Raw E2B SDK failures are normalized in `client-errors.ts` before adapter/runtime-control translate sandbox not-found cases to `SandboxResourceNotFoundError`.
- Authentication, rate-limit, template, build, and command-exit failures remain explicit through the E2B client error cause chain.
