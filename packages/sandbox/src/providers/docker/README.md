# Docker Provider

Docker implementation for `@mistle/sandbox`.

## Config

`createSandboxAdapter({ provider: SandboxProvider.DOCKER, docker: ... })` and `createSandboxRuntimeControl({ provider: SandboxProvider.DOCKER, docker: ... })` both expect:

- `socketPath`: Docker daemon socket path, for example `/var/run/docker.sock`
- `networkName` (optional): Docker network name that started sandbox containers should join

All config fields are validated with Zod and fail fast when invalid.

## Usage

```ts
import {
  SandboxProvider,
  createSandboxAdapter,
  createSandboxRuntimeControl,
} from "@mistle/sandbox";

const dockerConfig = {
  socketPath: "/var/run/docker.sock",
  networkName: "mistle-sandbox-dev",
};

const adapter = createSandboxAdapter({
  provider: SandboxProvider.DOCKER,
  docker: dockerConfig,
});

const runtimeControl = createSandboxRuntimeControl({
  provider: SandboxProvider.DOCKER,
  docker: dockerConfig,
});
```

## Provider Behavior

- `prepareImage({ image })` pulls non-local image references and returns the same Docker image handle.
- `start({ image, env })` injects the shared required runtime env, binds `/sys/fs/cgroup` read-write, uses the host cgroup namespace, optionally joins `networkName`, and starts a container from `image.imageId`.
- `inspect({ id })` returns normalized lifecycle fields plus the raw Docker `container.inspect()` payload.
- `resume({ id })` starts the existing stopped container and returns the same runtime id.
- `captureSnapshot({ id })` commits the container with `pause: true` and returns a Docker image handle whose `imageId` is the commit id.
- `stop({ id })` stops the container without removing it.
- `destroy({ id })` force-removes the container.

## Runtime Control

- `ensureSandboxd({ id, artifact })` resets transparent-egress nftables state, then runs the sandboxd installer as `root` with the requested artifact URL, SHA-256, and version.
- `readSandboxdVersion({ id })` runs `/opt/mistle/bin/sandboxd version` as `root` in the container and returns trimmed stdout.
- `beginInit({ id, payload, env })` runs `/opt/mistle/bin/sandboxd init --detach` as `root` in the container, writes `payload` to stdin, and waits for command exit.
- `init({ id, payload })` runs `/opt/mistle/bin/sandboxd init` as `root` in the container, writes `payload` to stdin, waits for process exit, and includes stdout/stderr in failures.
- `waitInit({ id, env })` runs `/opt/mistle/bin/sandboxd wait-init` as `root` in the container and waits for command exit.
- `activate({ id, payload, env })` runs `/opt/mistle/bin/sandboxd activate` as `root` in the container, writes `payload` to stdin, waits for process exit, and includes stdout/stderr in failures.
- `resume({ id, payload })` currently delegates to `init(...)`; the worker passes Docker resume startup mode as a new runtime startup.
- `readOperationLog({ id, operation })` reads `/run/mistle/init.log` or `/run/mistle/resume.log` from the container and returns `null` when the log is absent or empty.
- `close()` is currently a no-op.

## Error Surface

Docker API errors are mapped to `DockerClientError` with:

- `code`: `not_found`, `conflict`, `invalid_argument`, `unauthenticated`, `unknown`
- `operation`: identifies the failing operation, for example `pull_image`, `create_container`, `init`, or `read_operation_log`
- `retryable`: retry hint for caller policy

Adapter and runtime-control methods translate Docker not-found errors for sandbox compute into `SandboxResourceNotFoundError`.
