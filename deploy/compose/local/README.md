# Local Compose

This is the supported local testing entrypoint for Mistle.

It is designed for:

- running the full product on one machine
- Mailpit-backed local auth
- Docker-backed sandbox runtime
- callback-capable local integration testing by default

It is not the production deployment artifact.

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

   `./up.sh` creates `.env` from `.env.example` automatically if it does not exist yet.

   This build also publishes the local sandbox base image used for Docker-backed sessions
   into the bundled local registry:
   `localhost:5001/mistle/sandbox-base:local`

   Local Compose also provisions integration targets from the generated default manifest at
   `deploy/compose/local/config/integration-targets.provision.json`, so the dashboard starts
   with the supported integrations visible by default.

   `./up.sh` also makes the stack callback-capable for testing by default:
   - if `MISTLE_APPS_CONTROL_PLANE_API_AUTH_BASE_URL` is set in `.env`, it uses that value
   - if it is blank, it starts a temporary `cloudflare/cloudflared` container and injects the
     generated public URL for this run

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

## What You Usually Need To Change

Most users do not need to edit `.env` at all.

The main optional override is:

- `MISTLE_APPS_CONTROL_PLANE_API_AUTH_BASE_URL`
  - leave it blank for the default quick-tunnel testing flow
  - set it only when you want to override the quick tunnel with a stable public URL

Optional advanced setup:

- Google auth client ID/secret
- stable public callback URL
- local integration-target provisioning customization

## Callback Behavior

The dashboard always stays on `http://localhost:3000`.

Integration callbacks derive from the control-plane auth/public base URL:

- if `MISTLE_APPS_CONTROL_PLANE_API_AUTH_BASE_URL` is set, `./up.sh` uses it
- if it is blank, `./up.sh` starts a Dockerized Cloudflare quick tunnel to `http://localhost:8080`
- the generated public URL is injected through `.generated/runtime.env` for the current run only
- `./down.sh` stops the stack and removes the wrapper-managed quick tunnel container and generated files

GitHub examples:

- PAT/API key: no inbound callback required
- GitHub App installation: requires a reachable webhook URL and shared webhook secret

## Advanced Customization

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
