# Modal Provider

Modal implementation for `@mistle/sandbox`.

## Config

`createSandboxAdapter({ provider: SandboxProvider.MODAL, modal: ... })` expects:

- `tokenId`: Modal token id
- `tokenSecret`: Modal token secret
- `appName`: Modal app name used for sandbox creation
- `environmentName` (optional): Modal environment override

Recommended environment variable mapping:

- `MODAL_TOKEN_ID` -> `tokenId`
- `MODAL_TOKEN_SECRET` -> `tokenSecret`
- `MODAL_ENVIRONMENT` -> `environmentName`

All config fields are validated with Zod and fail fast when invalid.

## Usage

```ts
import { createSandboxAdapter, SandboxProvider } from "@mistle/sandbox";

const adapter = createSandboxAdapter({
  provider: SandboxProvider.MODAL,
  modal: {
    tokenId: process.env.MODAL_TOKEN_ID ?? "",
    tokenSecret: process.env.MODAL_TOKEN_SECRET ?? "",
    appName: "mistle-sandbox",
    environmentName: process.env.MODAL_ENVIRONMENT,
  },
});
```

## Provider Behavior

- `createVolume({})` creates a named Modal volume and returns an opaque handle.
- `deleteVolume({ volumeId })` deletes that named Modal volume.
- `start({ image, mounts })` resolves Modal app and image, then creates a sandbox with optional volume mounts.
- `resume({ image, mounts })` creates fresh Modal sandbox compute attached to the provided mounts. `previousRuntimeId` is accepted by the public API but not required by the provider implementation.
- returned `SandboxHandle` supports `writeStdin({ payload })` and `closeStdin()` via Modal sandbox stdin stream APIs.
- `stop({ runtimeId })` resolves sandbox and terminates the current runtime.
- `destroy({ runtimeId })` resolves sandbox and terminates the current runtime.

## Error Surface

SDK and gRPC errors are mapped to `ModalClientError` with:

- `code`: `not_found`, `already_exists`, `invalid_argument`, `unauthenticated`, `timeout`, `unknown`
- `operation`: identifies failing operation (`resolve_app`, `resolve_image`, `start_sandbox`, etc.)
- `retryable`: retry hint for caller policy

See implementation details in `client-errors.ts`.

## Integration Tests

Modal adapter integration tests call the real Modal API and are opt-in.
They cover the adapter lifecycle surface for `createVolume`, `deleteVolume`, `start`, `resume`,
`stop`, `destroy`, stdin writes, env injection, mounted-volume persistence, and filesystem access inside a started sandbox.

Required environment variables when enabled:

- `MISTLE_TEST_SANDBOX_INTEGRATION=1`
- `MISTLE_TEST_SANDBOX_INTEGRATION_PROVIDERS` includes `modal`
- `MODAL_TOKEN_ID`
- `MODAL_TOKEN_SECRET`
- `MISTLE_SANDBOX_MODAL_APP_NAME`

Optional:

- `MISTLE_SANDBOX_MODAL_ENVIRONMENT`

The integration fixture ensures the configured app exists (`createIfMissing: true`) before running
adapter lifecycle operations.

Integration tests build from the public base image
`ghcr.io/mistlehq/sandbox-base:latest` and then apply an ephemeral keepalive entrypoint
for adapter lifecycle coverage.

Run:

```bash
pnpm --filter @mistle/sandbox test:integration
```
