# Docker Provider

Docker implementation for `@mistle/sandbox`.

## Config

`createSandboxAdapter({ provider: SandboxProvider.DOCKER, docker: ... })` and
`createSandboxRuntimeControl({ provider: SandboxProvider.DOCKER, docker: ... })` both expect:

- `socketPath`: Docker daemon socket path (for example `/var/run/docker.sock`)
- `networkName` (optional): Docker network name that started sandbox containers should join

All config fields are validated with Zod and fail fast when invalid.

## Usage

```ts
import {
  createSandboxAdapter,
  createSandboxRuntimeControl,
  SandboxProvider,
} from "@mistle/sandbox";

const adapter = createSandboxAdapter({
  provider: SandboxProvider.DOCKER,
  docker: {
    socketPath: "/var/run/docker.sock",
    networkName: "mistle-sandbox-dev",
  },
});
const runtimeControl = createSandboxRuntimeControl({
  provider: SandboxProvider.DOCKER,
  docker: {
    socketPath: "/var/run/docker.sock",
    networkName: "mistle-sandbox-dev",
  },
});
```

## Provider Behavior

- `start({ image })` pulls the image reference and starts a Docker container from it.
- `resume({ image, id })` restarts the existing stopped Docker container identified by `id`.
- `createSandboxRuntimeControl(...).applyStartup({ id, payload })` runs `sandboxd apply-startup` as `root` inside the target container.
- returned `SandboxHandle` supports `writeStdin({ payload })` and `closeStdin()` for container stdin lifecycle.
- `stop({ id })` stops the Docker container without removing it.
- `destroy({ id })` force-removes the Docker container.

## Error Surface

Docker API errors are mapped to `DockerClientError` with:

- `code`: `not_found`, `conflict`, `invalid_argument`, `unauthenticated`, `unknown`
- `operation`: identifies failing operation (`pull_image`, `create_container`, `attach_stdin`, `write_stdin`, `close_stdin`, etc.)
- `retryable`: retry hint for caller policy
