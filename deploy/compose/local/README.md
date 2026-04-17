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

1. Change into the local Compose directory:

   ```bash
   cd deploy/compose/local
   ```

2. Copy the environment file if it does not exist yet:

   ```bash
   cp .env.example .env
   ```

3. Start the stack through the testing wrapper:

   ```bash
   ./up.sh
   ```

   This build also publishes the local sandbox base image used for Docker-backed sessions
   into the bundled local registry:
   `localhost:5001/mistle/sandbox-base:local`

   Local Compose also provisions integration targets from the generated default manifest at
   `deploy/compose/local/config/integration-targets.provision.json`, so the dashboard starts
   with the supported integrations visible by default.

   If `MISTLE_APPS_CONTROL_PLANE_API_AUTH_BASE_URL` is blank in `.env`, `./up.sh` starts
   an ephemeral Cloudflare quick tunnel in Docker for `http://localhost:8080` and injects the
   public URL for this run. If the variable is already set, `./up.sh` uses that value unchanged.

4. Open the product:

- Dashboard: `http://localhost:3000`
- Control Plane API: `http://localhost:8080`
- Data Plane Gateway: `http://localhost:8084`
- Tokenizer Proxy: `http://localhost:8085`
- Mailpit UI: `http://localhost:8025`

The local registry at `http://localhost:5001` is an internal runtime dependency for sandbox
image pulls. It is not a user-facing product surface.

5. Run the acceptance smoke test from the repo root:

   ```bash
   pnpm compose:local:smoke-test -- --restart-check
   ```

## Callback-Capable Local Mode

Baseline local mode always keeps the dashboard on `http://localhost:3000`.

For redirect- or webhook-based integrations, `./up.sh` will create an ephemeral callback URL
automatically when:

- `MISTLE_APPS_CONTROL_PLANE_API_AUTH_BASE_URL` is unset or blank

Set this variable explicitly when you want to override the quick tunnel with a stable public URL:

- `MISTLE_APPS_CONTROL_PLANE_API_AUTH_BASE_URL`

This mirrors the existing dev model:

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
cd deploy/compose/local
./down.sh
```

Remove local state:

```bash
cd deploy/compose/local
./down.sh -v
```
