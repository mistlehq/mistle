# Base Image

The base image includes a single sandbox runtime entrypoint that every sandbox will have.

## Current Responsibilities

- Package the SEA sandbox bootstrap/runtime binaries from `apps/sandbox-runtime-node`
- Start the root-owned bootstrap entrypoint under `tini`
- Generate a fresh per-sandbox proxy CA, install its certificate into the OS trust store, and pass signer material to the runtime
- Drop privileges to the `sandbox` user before execing the runtime
- Install `mise` as the runtime manager at `/usr/local/bin/mise`
- Pre-create user-owned sandbox state under `/home/sandbox`
- Pre-create runtime-owned mutable state under `/var/lib/mistle`

## Runtime Contract

- Entry point: `/usr/local/bin/sandbox-bootstrap`
- Bootstrap exec target: `/usr/local/bin/sandboxd`
- Default listen address: `SANDBOX_RUNTIME_LISTEN_ADDR=:8090`
- Sandbox user env: `SANDBOX_USER` is reserved and must remain `sandbox`
- Tokenizer proxy egress base URL env: `SANDBOX_RUNTIME_TOKENIZER_PROXY_EGRESS_BASE_URL`
- Bootstrap-generated proxy CA install path: `/usr/local/share/ca-certificates/mistle-proxy-ca.crt`
- Bootstrap passes the proxy CA signer into the runtime through inherited file descriptors exposed as:
  - `SANDBOX_RUNTIME_PROXY_CA_CERT_FD`
  - `SANDBOX_RUNTIME_PROXY_CA_KEY_FD`
- `update-ca-certificates` is run after writing the generated proxy CA certificate before privileges are dropped
- Startup input: JSON must be provided via process `stdin` during startup with required fields:
  - `bootstrapToken`
  - `tunnelGatewayWsUrl`
  - `runtimePlan`
- Health endpoint: `GET /__healthz` returns 200 only after bootstrap token is loaded
- Egress behavior: the runtime acts as an outbound HTTP(S) proxy and forwards matched integration traffic to tokenizer proxy egress
- User-owned persistent state lives under `/home/sandbox`
- Runtime-owned mutable state lives under `/var/lib/mistle`
- `PATH` includes `/var/lib/mistle/bin` and `mise` shims at `/home/sandbox/.local/share/mise/shims`
