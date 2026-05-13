# Single-node Docker Compose

This is the supported single-node Docker Compose workflow for Mistle.
It pulls the published single-container app image plus local infrastructure images, and runs the
product on one machine with Mailpit-backed auth, Docker-backed sessions, and webhook-capable
integration testing by default. It is not the production deployment artifact.
`deploy/compose/local/compose.yaml` is the single local Compose source of truth.

## Prerequisites

- Docker Desktop or Docker Engine with Compose v2

## First Run

To install and start Mistle without cloning the repository:

```bash
curl -fsSL https://raw.githubusercontent.com/mistlehq/mistle/main/deploy/compose/local/install.sh | sh
```

The installer writes the local Compose files to `~/.mistle/local`, creates `.env` from
`.env.example` if needed, preserves an existing `.env`, and runs `./up.sh`.

For repo-local development:

1. Change into the local Compose directory:

   ```bash
   cd deploy/compose/local
   ```

2. Start the stack:

   ```bash
   ./up.sh
   ```

   `./up.sh` creates `.env` from `.env.example` automatically if it does not exist yet, pulls the
   published single-container app image and sandbox image derived from `VERSION`, ensures local
   object-store buckets exist, provisions the default integration targets, and ensures the control
   plane has a public webhook URL for the current run.

3. Open the product:

- Dashboard: `http://localhost:3000`
- Control Plane API: `http://localhost:5100`
- Data Plane Gateway: `http://localhost:5202`
- Tokenizer Proxy: `http://localhost:5205`
- Mailpit UI: `http://localhost:8025`

4. Run the acceptance smoke test from the repo root:

   ```bash
   pnpm compose:local:smoke-test -- --restart-check
   ```

## Configuration

Most users do not need to edit `.env`.

The main optional overrides are:

- `MISTLE_DOCKER_IMAGE` to choose the published single-container app image
- `MISTLE_SANDBOX_DEFAULT_BASE_IMAGE` to choose the sandbox base image used by Docker-backed sessions
- `MISTLE_SERVICES_CONTROL_PLANE_API_PUBLIC_URL`

If the image values are blank, `./up.sh` derives them from the installed or repository `VERSION`
file. For `VERSION=0.8.0`, that resolves to `ghcr.io/mistlehq/mistle:docker-v0.8.0` and
`ghcr.io/mistlehq/sandbox-base:v0.8.0`.

For `MISTLE_SERVICES_CONTROL_PLANE_API_PUBLIC_URL`:

- leave it blank for the default quick-tunnel flow
- set it only when you want a stable public webhook URL instead

## Callback Behavior

The dashboard always stays on `http://localhost:3000`.

Webhook-style integration callbacks derive from the control-plane auth/public base URL.

- If `MISTLE_SERVICES_CONTROL_PLANE_API_PUBLIC_URL` is set, `./up.sh` uses it.
- If it is blank, `./up.sh` starts a Dockerized Cloudflare quick tunnel to `http://localhost:5100`.
- The generated public URL is injected through `.generated/runtime.env` for the current run only.
- `./down.sh` stops the stack, force-removes worker-created Docker sandbox runtime containers attached to the local sandbox network, and removes the wrapper-managed quick tunnel container and generated files.

This default quick-tunnel flow is for server-to-server webhook delivery. It is not intended for
browser callback flows such as Google sign-in or OAuth flows that start on `localhost` and return
to a different public host.

GitHub examples:

- PAT/API key: no inbound callback required
- GitHub App installation: requires a reachable webhook URL and shared webhook secret

## Stop And Reset

Stop the stack:

```bash
cd deploy/compose/local
./down.sh
```

Remove local state:

```bash
cd deploy/compose/local
./down.sh -v
```
