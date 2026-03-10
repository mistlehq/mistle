# Base Image

The base image includes a single sandbox runtime entrypoint that every sandbox will have.

## Current Responsibilities

- Build Go `sandboxd` from `apps/sandbox-runtime`
- Start the root-owned bootstrap entrypoint under `tini`
- Install an injected proxy CA certificate into the OS trust store when provided
- Drop privileges to the `sandbox` user before execing `sandboxd`
- Install `mise` as the runtime manager at `/usr/local/bin/mise`

## Runtime Contract

- Entry point: `/usr/local/bin/sandbox-bootstrap`
- Bootstrap exec target: `/usr/local/bin/sandboxd`
- Default listen address: `SANDBOX_RUNTIME_LISTEN_ADDR=:8090`
- Sandbox user env: `SANDBOX_USER` defaults to `sandbox`
- Tokenizer proxy egress base URL env: `SANDBOX_RUNTIME_TOKENIZER_PROXY_EGRESS_BASE_URL`
- Optional proxy CA certificate path env: `SANDBOX_RUNTIME_PROXY_CA_CERT_PATH`
  - when set, it must point to an absolute path readable by the root-owned bootstrap process
  - the certificate is installed into `/usr/local/share/ca-certificates/mistle-proxy-ca.crt`
  - `update-ca-certificates` is run before privileges are dropped
- Startup input: JSON must be provided via process `stdin` during startup with required fields:
  - `bootstrapToken`
  - `tunnelGatewayWsUrl`
  - `runtimePlan`
- Health endpoint: `GET /__healthz` returns 200 only after bootstrap token is loaded
- Egress endpoint: `/egress/routes/{routeId}` forwards requests to tokenizer proxy egress endpoint
- `PATH` includes `mise` shims at `/home/sandbox/.local/share/mise/shims`
