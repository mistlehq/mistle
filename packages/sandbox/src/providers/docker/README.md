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

- `prepareStorageForStart({ image, storage })` requires a Docker image handle and a `docker_volume` storage attachment. It runs a short-lived `alpine:3.20` init container that creates the configured volume subpaths before the sandbox container starts.
- `start({ image, env, storagePreparation })` pulls non-local image references, injects the shared required runtime env, mounts Docker volume subpaths when provided, binds `/sys/fs/cgroup` read-write, uses the host cgroup namespace, optionally joins `networkName`, and starts a container from `image.imageId`.
- `inspect({ id })` returns normalized lifecycle fields plus the raw Docker `container.inspect()` payload.
- `resume({ id })` starts the existing stopped container and returns the same runtime id.
- `captureSnapshot({ id })` commits the container with `pause: true` and returns a Docker image handle whose `imageId` is the commit id.
- `attachStorage(...)` and `cleanupStorage(...)` are currently no-ops for Docker because persistent storage is attached as Docker volume mounts during container creation.
- `stop({ id })` stops the container without removing it.
- `destroy({ id })` force-removes the container.

## Runtime Control

- `init({ id, payload })` runs `/opt/mistle/bin/sandboxd init` as `root` in the container, writes `payload` to stdin, waits for process exit, and includes stdout/stderr in failures.
- `resume({ id, payload })` currently delegates to `init(...)`; the worker passes Docker resume startup mode as a new runtime startup.
- `readOperationLog({ id, operation })` reads `/run/mistle/init.log` or `/run/mistle/resume.log` from the container and returns `null` when the log is absent or empty.
- `close()` is currently a no-op.

## Storage Notes

Docker persistent storage uses the `docker_volume` backend. The data-plane worker provisions and records the Docker volume; this provider prepares the volume subpaths and mounts them into the sandbox container according to `SandboxPersistentStorageLayout`.

`prepareStorageForStart(...)` fails fast when persistent Docker startup does not include a Docker volume attachment. `start(...)` fails fast when it receives a non-Docker storage preparation payload.

## Error Surface

Docker API errors are mapped to `DockerClientError` with:

- `code`: `not_found`, `conflict`, `invalid_argument`, `unauthenticated`, `unknown`
- `operation`: identifies the failing operation, for example `pull_image`, `create_container`, `init`, or `read_operation_log`
- `retryable`: retry hint for caller policy

Adapter and runtime-control methods translate Docker not-found errors for sandbox compute into `SandboxResourceNotFoundError`.
