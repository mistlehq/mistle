# Sandbox Runtime

This app is the canonical sandbox runtime implementation.

It owns:

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
- starts `/usr/local/bin/sandbox-bootstrap` under `tini`
- trusts a per-sandbox proxy CA before dropping privileges
- execs `/usr/local/bin/sandboxd` as the `sandbox` user
- provides `mise` at `/usr/local/bin/mise`
- includes a small developer tool set: `bash`, `curl`, `git`, `iproute2`, `jq`, `less`, `lsof`, `procps`, `ripgrep`, `strace`, `unzip`, and `vim`

## Runtime Contract

- Bootstrap entrypoint: `/usr/local/bin/sandbox-bootstrap`
- Runtime executable: `/usr/local/bin/sandboxd`
- Default listen address: `SANDBOX_RUNTIME_LISTEN_ADDR=:8090`
- Sandbox user env: `SANDBOX_USER` is reserved and must remain `sandbox`
- Tokenizer proxy egress base URL env: `SANDBOX_RUNTIME_TOKENIZER_PROXY_EGRESS_BASE_URL`
- Proxy CA install path: `/usr/local/share/ca-certificates/mistle-proxy-ca.crt`
- Proxy CA signer FDs are passed through:
  - `SANDBOX_RUNTIME_PROXY_CA_CERT_FD`
  - `SANDBOX_RUNTIME_PROXY_CA_KEY_FD`
- Startup input must be provided on process `stdin` with:
  - `bootstrapToken`
  - `tunnelGatewayWsUrl`
  - `runtimePlan`
- `GET /__healthz` returns 200 only after startup is ready
- User-owned state lives under `/home/sandbox`
- Runtime-owned mutable state lives under `/var/lib/mistle`
