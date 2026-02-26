# Base Image

The base image includes a single sandbox runtime entrypoint that every sandbox will have.

## Current Responsibilities

- Build Rust `sandboxd` from `apps/sandbox-runtime`
- Start `sandboxd` under `tini`
- Install `mise` as the runtime manager at `/usr/local/bin/mise`

## Runtime Contract

- Entry point: `/usr/local/bin/sandboxd`
- Default listen address: `SANDBOX_RUNTIME_LISTEN_ADDR=:8090`
- `PATH` includes `mise` shims at `/home/sandbox/.local/share/mise/shims`
