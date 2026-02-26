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

- `start({ image })` resolves Modal app and image, then creates a sandbox.
- `snapshot({ sandboxId })` snapshots sandbox filesystem to a new image handle.
- `stop({ sandboxId })` resolves sandbox and terminates it.

## Error Surface

SDK and gRPC errors are mapped to `ModalClientError` with:

- `code`: `not_found`, `already_exists`, `invalid_argument`, `unauthenticated`, `timeout`, `unknown`
- `operation`: identifies failing operation (`resolve_app`, `resolve_image`, `start_sandbox`, etc.)
- `retryable`: retry hint for caller policy

See implementation details in `client-errors.ts`.
