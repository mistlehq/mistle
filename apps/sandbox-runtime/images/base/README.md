# Base Image

The base image includes a single sandbox runtime entrypoint that every sandbox will have.

## Current Responsibilities

- Build Go `sandboxd` from `apps/sandbox-runtime`
- Start `sandboxd` under `tini`
- Install `mise` as the runtime manager at `/usr/local/bin/mise`

## Runtime Contract

- Entry point: `/usr/local/bin/sandboxd`
- Default listen address: `SANDBOX_RUNTIME_LISTEN_ADDR=:8090`
- Tokenizer proxy egress base URL env: `SANDBOX_RUNTIME_TOKENIZER_PROXY_EGRESS_BASE_URL`
- Startup input: JSON must be provided via process `stdin` during startup with required fields:
  - `bootstrapToken`
  - `tunnelGatewayWsUrl`
  - `runtimePlan`
- Health endpoint: `GET /__healthz` returns 200 only after bootstrap token is loaded
- Egress endpoint: `/egress/routes/{routeId}` forwards requests to tokenizer proxy egress endpoint
- `PATH` includes `mise` shims at `/home/sandbox/.local/share/mise/shims`
