# Local Compose

This is the supported local testing entrypoint for Mistle.
It runs the product on one machine with Mailpit-backed auth, Docker-backed sessions, and
webhook-capable integration testing by default. It is not the production deployment artifact.
`deploy/compose/local/compose.yaml` is the single local Compose source of truth.

## Prerequisites

- Docker Desktop or Docker Engine with Compose v2

## First Run

1. Change into the local Compose directory:

   ```bash
   cd deploy/compose/local
   ```

2. Start the stack:

   ```bash
   ./up.sh
   ```

   `./up.sh` creates `.env` from `.env.example` automatically if it does not exist yet, pushes
   the local sandbox base image into the bundled registry, provisions the default integration
   targets, and ensures the control plane has a public webhook URL for the current run.

3. Open the product:

- Dashboard: `http://localhost:3000`
- Control Plane API: `http://localhost:8080`
- Data Plane Gateway: `http://localhost:8084`
- Mailpit UI: `http://localhost:8025`

The local registry at `http://localhost:5001` is only an internal runtime dependency. It remains
host-exposed because the host Docker daemon both pushes and later pulls the sandbox base image
through that registry when local sandbox instances start.

4. Run the acceptance smoke test from the repo root:

   ```bash
   pnpm compose:local:smoke-test -- --restart-check
   ```

## Configuration

Most users do not need to edit `.env`.

The main optional override is `MISTLE_APPS_CONTROL_PLANE_API_AUTH_BASE_URL`:

- leave it blank for the default quick-tunnel flow
- set it only when you want a stable public webhook URL instead

## Callback Behavior

The dashboard always stays on `http://localhost:3000`.

Webhook-style integration callbacks derive from the control-plane auth/public base URL.

- If `MISTLE_APPS_CONTROL_PLANE_API_AUTH_BASE_URL` is set, `./up.sh` uses it.
- If it is blank, `./up.sh` starts a Dockerized Cloudflare quick tunnel to `http://localhost:8080`.
- The generated public URL is injected through `.generated/runtime.env` for the current run only.
- `./down.sh` stops the stack and removes the wrapper-managed quick tunnel container and generated files.

This default quick-tunnel flow is for server-to-server webhook delivery. It is not intended for
browser callback flows such as Google sign-in or OAuth flows that start on `localhost` and return
to a different public host.

GitHub examples:

- PAT/API key: no inbound callback required
- GitHub App installation: requires a reachable webhook URL and shared webhook secret

## Advanced Customization

To customize the default provisioned targets:

1. Edit `integration-targets.provision.example.json`
2. Regenerate the local Compose manifest:

   ```bash
   pnpm generate:local-provision-manifest
   ```

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
