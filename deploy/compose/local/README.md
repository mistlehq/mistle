# Local Compose

This is the supported local full-product Compose entrypoint for Mistle.

It is designed for:

- running the full product on one machine
- Mailpit-backed local auth
- Docker-backed sandbox runtime
- optional callback-capable integration setup

It is not the production deployment artifact.

## Prerequisites

- Docker Desktop or Docker Engine with Compose v2

## First Run

1. Copy the environment file:

   ```bash
   cp deploy/compose/local/.env.example deploy/compose/local/.env
   ```

2. Start the stack:

   ```bash
   docker compose \
     -f deploy/compose/base/compose.yaml \
     -f deploy/compose/local/compose.yaml \
     --env-file deploy/compose/local/.env \
     up -d --build
   ```

   This build also publishes the local sandbox base image used for Docker-backed sessions
   into the bundled local registry:
   `localhost:5001/mistle/sandbox-base:local`

   Local Compose also provisions integration targets from the generated default manifest at
   `deploy/compose/local/config/integration-targets.provision.json`, so the dashboard starts
   with the supported integrations visible by default.

3. Open the product:

- Dashboard: `http://localhost:3000`
- Control Plane API: `http://localhost:8080`
- Data Plane Gateway: `http://localhost:8084`
- Tokenizer Proxy: `http://localhost:8085`
- Mailpit UI: `http://localhost:8025`

The local registry at `http://localhost:5001` is an internal runtime dependency for sandbox
image pulls. It is not a user-facing product surface.

4. Run the acceptance smoke test:

   ```bash
   pnpm compose:local:smoke-test -- --restart-check
   ```

## Callback-Capable Local Mode

Baseline local mode assumes the dashboard talks to `http://localhost:8080`.

For redirect- or webhook-based integrations, set:

- `MISTLE_APPS_CONTROL_PLANE_API_AUTH_BASE_URL`

to a reachable external URL before startup. This mirrors the existing dev model:

- dashboard/browser origin can stay on localhost
- integration callbacks derive from the control-plane auth/public base URL

GitHub guidance:

- PAT/API key: no inbound callback required
- GitHub App installation: requires a reachable webhook URL and shared webhook secret

To customize the default local target provisioning:

1. Edit `integration-targets.provision.example.json`
2. Regenerate the local Compose manifest:

   ```bash
   pnpm generate:local-provision-manifest
   ```

## Stop And Reset

Stop the stack:

```bash
docker compose \
  -f deploy/compose/base/compose.yaml \
  -f deploy/compose/local/compose.yaml \
  --env-file deploy/compose/local/.env \
  down
```

Remove local state:

```bash
docker compose \
  -f deploy/compose/base/compose.yaml \
  -f deploy/compose/local/compose.yaml \
  --env-file deploy/compose/local/.env \
  down -v
```
