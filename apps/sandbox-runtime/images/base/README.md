# Base Image

The base image includes a single sandbox runtime entrypoint that every sandbox will have.

## Current Responsibilities

- Build Go `sandboxd` from `apps/sandbox-runtime`
- Start `sandboxd` under `tini`
- Install `mise` as the runtime manager at `/usr/local/bin/mise`

## Runtime Contract

- Entry point: `/usr/local/bin/sandboxd`
- Default listen address: `SANDBOX_RUNTIME_LISTEN_ADDR=:8090`
- Startup input: JSON must be provided via process `stdin` during startup with required fields:
  - `bootstrapToken`
  - `tunnelGatewayWsUrl`
- Health endpoint: `GET /__healthz` returns 200 only after bootstrap token is loaded
- `PATH` includes `mise` shims at `/home/sandbox/.local/share/mise/shims`
