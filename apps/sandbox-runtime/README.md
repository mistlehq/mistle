# Sandbox Runtime

This app is the canonical sandbox runtime implementation.

It owns:

- supervisor orchestration for secure one-shot startup configuration
- bootstrap orchestration for root-only proxy CA trust setup
- runtime startup, health, proxying, runtime-plan application, and tunnel handling
- Linux SEA packaging for `sandbox-bootstrap` and `sandboxd`
- the base sandbox image definition used by the system harness and dev flows

The native boundary lives in `packages/sandbox-rs-napi`.

Rust owns:

- PTY primitives
- managed process spawn / signal / process-group behavior
- proxy CA inherited-FD handoff
- privilege drop, stdio inheritance, and Linux hardening helpers

TypeScript owns:

- bootstrap and runtime orchestration
- runtime-plan behavior
- proxy policy and forwarding
- tunnel protocol handling
- provider/runtime integration logic

## Layout

- `src/`: runtime and bootstrap application code
- `integration/`: app-level integration coverage
- `scripts/`: SEA bundle/build/smoke helpers
- `Dockerfile`: canonical sandbox base image definition
- `mistle-path.sh`: image shell-path setup

## Base Image

Build with repository root as context:

```bash
docker build --target sandbox-base -f apps/sandbox-runtime/Dockerfile .
```

Before building the image, generate Linux SEA artifacts into `apps/sandbox-runtime/dist-sea`:

```bash
pnpm build:sandbox-runtime:sea:linux
```

The base image:

- packages the SEA binaries from `apps/sandbox-runtime/dist-sea`
- starts `/usr/local/bin/sandboxd serve` under `tini`
- accepts one startup payload through `/usr/local/bin/sandboxd apply-startup`
- launches `/usr/local/bin/sandbox-bootstrap runtime-internal` only after startup is applied
- trusts a per-sandbox proxy CA before dropping privileges
- execs `/usr/local/bin/sandboxd runtime-internal` as the `sandbox` user
- provides `mise` at `/usr/local/bin/mise`
- includes a small developer tool set: `bash`, `curl`, `git`, `iproute2`, `jq`, `less`, `lsof`, `procps`, `ripgrep`, `strace`, `unzip`, and `vim`

## Runtime Contract

- Supervisor entrypoint: `/usr/local/bin/sandboxd serve`
- Startup apply command: `/usr/local/bin/sandboxd apply-startup`
- Internal bootstrap command: `/usr/local/bin/sandbox-bootstrap runtime-internal`
- Runtime executable: `/usr/local/bin/sandboxd runtime-internal`
- Default listen address: `SANDBOX_RUNTIME_LISTEN_ADDR=:8090`
- Control directory env: `SANDBOX_RUNTIME_CONTROL_DIR` defaults to `/run/mistle`
- Sandbox user env: `SANDBOX_USER` is reserved and must remain `sandbox`
- Tokenizer proxy egress base URL env: `SANDBOX_RUNTIME_TOKENIZER_PROXY_EGRESS_BASE_URL`
- Proxy CA install path: `/usr/local/share/ca-certificates/mistle-proxy-ca.crt`
- Proxy CA signer FDs are passed through:
  - `SANDBOX_RUNTIME_PROXY_CA_CERT_FD`
  - `SANDBOX_RUNTIME_PROXY_CA_KEY_FD`
- Startup input must be provided to `sandboxd apply-startup` on process `stdin` with:
  - `bootstrapToken`
  - `tunnelExchangeToken`
  - `tunnelGatewayWsUrl`
  - `runtimePlan`
- The supervisor control socket and token live under `/run/mistle` with root-only permissions in the image runtime
- `GET /__healthz` returns 200 only after startup is ready
- User-owned state lives under `/home/sandbox`
- Runtime-owned mutable state lives under `/var/lib/mistle`
