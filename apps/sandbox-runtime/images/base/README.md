# Base Image

The base image includes a single sandbox runtime entrypoint that every sandbox will have.

## Current Responsibilities

- Build Go `sandboxd` from `apps/sandbox-runtime`
- Start the root-owned bootstrap entrypoint under `tini`
- Generate a fresh per-sandbox proxy CA, install its certificate into the OS trust store, and pass signer material to `sandboxd`
- Drop privileges to the `sandbox` user before execing `sandboxd`
- Install `mise` as the runtime manager at `/usr/local/bin/mise`

## Runtime Contract

- Entry point: `/usr/local/bin/sandbox-bootstrap`
- Bootstrap exec target: `/usr/local/bin/sandboxd`
- Default listen address: `SANDBOX_RUNTIME_LISTEN_ADDR=:8090`
- Sandbox user env: `SANDBOX_USER` is reserved and must remain `sandbox`
- Tokenizer proxy egress base URL env: `SANDBOX_RUNTIME_TOKENIZER_PROXY_EGRESS_BASE_URL`
- Bootstrap-generated proxy CA install path: `/usr/local/share/ca-certificates/mistle-proxy-ca.crt`
- Bootstrap passes the proxy CA signer into `sandboxd` through inherited file descriptors exposed as:
  - `SANDBOX_RUNTIME_PROXY_CA_CERT_FD`
  - `SANDBOX_RUNTIME_PROXY_CA_KEY_FD`
- `update-ca-certificates` is run after writing the generated proxy CA certificate before privileges are dropped
- Startup input: JSON must be provided via process `stdin` during startup with required fields:
  - `bootstrapToken`
  - `tunnelGatewayWsUrl`
  - `runtimePlan`
- Health endpoint: `GET /__healthz` returns 200 only after bootstrap token is loaded
- Egress behavior: `sandboxd` acts as an outbound HTTP(S) proxy and forwards matched integration traffic to tokenizer proxy egress
- `PATH` includes `mise` shims at `/home/sandbox/.local/share/mise/shims`
