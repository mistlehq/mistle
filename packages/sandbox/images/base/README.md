# Base Image

The base image includes a single sandbox runtime entrypoint that every sandbox will have.

## Current Responsibilities

- Build `sandboxd` from `apps/sandbox-runtime`
- Start `sandboxd` under `tini`

## Runtime Contract

- Entry point: `/usr/local/bin/sandboxd`
- Default listen address: `SANDBOX_RUNTIME_LISTEN_ADDR=:8080`
