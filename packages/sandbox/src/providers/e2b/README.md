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

- `prepareImage({ image })` resolves or builds a deterministic E2B template alias from OCI image references and returns an E2B image handle for that alias.
- `start({ image, env })` treats `image.imageId` as a prepared template alias, injects the shared required runtime env, and creates the sandbox.
- Created sandboxes use a one-hour timeout and `lifecycle.onTimeout: "pause"`.
- Created sandboxes store the resolved template alias in E2B metadata as `mistle_template_alias`.
- Starts are rate-limited in process and transient E2B source errors are retried before being mapped to `E2BClientError`.
- `inspect({ id })` returns normalized lifecycle fields plus the raw E2B `Sandbox.getInfo(...)` payload.
- `resume({ id })` reconnects to the same E2B sandbox id.
- `captureSnapshot({ id })` connects to the sandbox, calls `createSnapshot()`, and returns an E2B image handle whose `imageId` is the snapshot id.
- `stop({ id })` pauses the sandbox.
- `destroy({ id })` kills the sandbox permanently.

## Runtime Control

- `ensureSandboxd({ id, artifact, env })` stops any existing daemon state, resets transparent-egress nftables state, and runs the sandboxd installer with the requested artifact URL, SHA-256, and version.
- `readSandboxdVersion({ id, env })` runs `/opt/mistle/bin/sandboxd version` as `root` and returns trimmed stdout.
- `beginInit({ id, payload, env })` connects to the sandbox, ensures `sandboxd.service` is running, waits for daemon readiness, then runs `/opt/mistle/bin/sandboxd init --detach` with `payload` on stdin.
- `init({ id, payload, env })` connects to the sandbox, ensures `sandboxd.service` is running, waits for daemon readiness, then runs `/opt/mistle/bin/sandboxd init` with `payload` on stdin.
- `waitInit({ id, env })` connects to the sandbox, ensures `sandboxd.service` is running, waits for daemon readiness, then runs `/opt/mistle/bin/sandboxd wait-init`.
- `activate({ id, payload, env })` uses the same daemon readiness path, then runs `/opt/mistle/bin/sandboxd activate` with `payload` on stdin.
- `resume({ id, payload, env })` uses the same daemon readiness path, then runs `/opt/mistle/bin/sandboxd resume` so a paused daemon can reattach its bootstrap tunnel.
- `readOperationLog({ id, operation })` reads `/run/mistle/init.log` or `/run/mistle/resume.log` and returns `null` when the log is absent or empty.
- `close()` is currently a no-op.

## Error Surface

- Raw E2B SDK failures are normalized in `client-errors.ts` before adapter/runtime-control methods translate sandbox not-found cases to `SandboxResourceNotFoundError`.
- Authentication, rate-limit, template, build, command-exit, and unknown SDK failures remain explicit through the `E2BClientError` cause chain.
- Runtime command exits include stdout/stderr details when the E2B SDK exposes them.
