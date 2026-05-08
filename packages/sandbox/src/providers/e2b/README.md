# E2B Provider

E2B implementation for `@mistle/sandbox`.

## Config

`createSandboxAdapter({ provider: SandboxProvider.E2B, e2b: ... })` and `createSandboxRuntimeControl({ provider: SandboxProvider.E2B, e2b: ... })` both expect:

- `apiKey`: E2B API key
- `domain` (optional): override E2B domain when not using the default `e2b.app`
- `cpuCount` (optional): template CPU default for newly built E2B templates, defaults to `2`
- `memoryMb` (optional): template memory default in MB for newly built E2B templates, defaults to `4096`

All config fields are validated with Zod and fail fast when invalid.

## Usage

```ts
import {
  SandboxProvider,
  createSandboxAdapter,
  createSandboxRuntimeControl,
} from "@mistle/sandbox";

const e2bConfig = {
  apiKey: process.env.E2B_API_KEY ?? "",
};

const adapter = createSandboxAdapter({
  provider: SandboxProvider.E2B,
  e2b: e2bConfig,
});

const runtimeControl = createSandboxRuntimeControl({
  provider: SandboxProvider.E2B,
  e2b: e2bConfig,
});
```

## Provider Behavior

- `prepareStorageForStart(...)` returns empty storage preparation. E2B persistent storage is attached after compute starts.
- `start({ image, env })` treats `image.imageId` as an OCI image reference, resolves or builds a deterministic E2B template alias from that reference and the configured CPU/memory defaults, injects the shared required runtime env, and creates the sandbox.
- Created sandboxes use a one-hour timeout and `lifecycle.onTimeout: "pause"`.
- Created sandboxes store the resolved template alias in E2B metadata as `mistle_template_alias`.
- Starts are rate-limited in process and transient E2B source errors are retried before being mapped to `E2BClientError`.
- `inspect({ id })` returns normalized lifecycle fields plus the raw E2B `Sandbox.getInfo(...)` payload.
- `resume({ id })` reconnects to the same E2B sandbox id.
- `captureSnapshot({ id })` connects to the sandbox, calls `createSnapshot()`, and returns an E2B image handle whose `imageId` is the snapshot id.
- `stop({ id })` pauses the sandbox.
- `destroy({ id })` kills the sandbox permanently.

## Runtime Control

- `init({ id, payload, env })` connects to the sandbox, ensures `/opt/mistle/bin/sandboxd` is running as `root` through `/usr/bin/tini`, waits for daemon readiness, then runs `/opt/mistle/bin/sandboxd init` with `payload` on stdin.
- `resume({ id, payload, env })` uses the same daemon readiness path, then runs `/opt/mistle/bin/sandboxd resume` so a paused daemon can reattach its bootstrap tunnel.
- `readOperationLog({ id, operation })` reads `/run/mistle/init.log` or `/run/mistle/resume.log` and returns `null` when the log is absent or empty.
- `close()` is currently a no-op.

## Storage Notes

E2B persistent storage uses the `archil` backend. The data-plane worker provisions the Archil disk and resolves a disk token; this provider mounts the disk inside the sandbox and bind-mounts the shared persistent layout into place.

`attachStorage({ lifecycle: "start" | "resume", storage })` requires an Archil storage attachment. On first start attach, it hydrates Archil storage from existing target directories when the `.mistle-init` marker is absent, then bind-mounts each layout binding. On resume attach, it skips hydration and ensures the expected bind mounts exist. The Archil mount token is passed as `ARCHIL_MOUNT_TOKEN`.

`cleanupStorage(...)` currently validates the Archil cleanup payload and returns without running provider cleanup commands because current stop/destroy paths do not require in-guest Archil teardown.

## Error Surface

- Raw E2B SDK failures are normalized in `client-errors.ts` before adapter/runtime-control methods translate sandbox not-found cases to `SandboxResourceNotFoundError`.
- Authentication, rate-limit, template, build, command-exit, and unknown SDK failures remain explicit through the `E2BClientError` cause chain.
- Runtime command exits include stdout/stderr details when the E2B SDK exposes them.
