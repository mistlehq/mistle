# Docker Provider

Docker implementation for `@mistle/sandbox`.

## Config

`createSandboxAdapter({ provider: SandboxProvider.DOCKER, docker: ... })` expects:

- `socketPath`: Docker daemon socket path (for example `/var/run/docker.sock`)
- `networkName` (optional): Docker network name that started sandbox containers should join

All config fields are validated with Zod and fail fast when invalid.

## Usage

```ts
import { createSandboxAdapter, SandboxProvider } from "@mistle/sandbox";

const adapter = createSandboxAdapter({
  provider: SandboxProvider.DOCKER,
  docker: {
    socketPath: "/var/run/docker.sock",
    networkName: "mistle-sandbox-dev",
  },
});
```

## Provider Behavior

- `createVolume({})` creates a named Docker volume and returns an opaque handle.
- `deleteVolume({ volumeId })` removes that Docker volume.
- `start({ image, mounts })` pulls image reference and starts a Docker container with optional volume mounts.
- returned `SandboxHandle` supports `writeStdin({ payload })` and `closeStdin()` for container stdin lifecycle.
- `stop({ runtimeId })` force-removes the Docker container.

## Error Surface

Docker API errors are mapped to `DockerClientError` with:

- `code`: `not_found`, `conflict`, `invalid_argument`, `unauthenticated`, `unknown`
- `operation`: identifies failing operation (`pull_image`, `create_container`, `attach_stdin`, `write_stdin`, `close_stdin`, etc.)
- `retryable`: retry hint for caller policy
