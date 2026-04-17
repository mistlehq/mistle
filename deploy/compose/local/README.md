# Local Compose

This is the supported local full-product Compose entrypoint for Mistle.

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

   `./up.sh` always ensures the control plane has a public auth/callback URL for this run:

   - if `MISTLE_APPS_CONTROL_PLANE_API_AUTH_BASE_URL` is already set in `.env`, `./up.sh` uses
     that value unchanged
   - if it is blank, `./up.sh` starts a temporary `cloudflare/cloudflared` container, creates an
     ephemeral `trycloudflare.com` URL for `http://localhost:8080`, writes that URL into a generated
     runtime env file under `.generated/`, and starts Compose with that generated env file

   This makes the default local testing flow callback-capable without requiring any manual tunnel
   setup.

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

## Callback URL Behavior

The dashboard always stays on `http://localhost:3000`.

The control-plane public/auth base URL works like this:

- `./up.sh` reads `MISTLE_APPS_CONTROL_PLANE_API_AUTH_BASE_URL` from `.env`
- if it is set, that value becomes the callback/auth URL for the run
- if it is blank, `./up.sh` starts a Dockerized Cloudflare quick tunnel to `http://localhost:8080`
- `./up.sh` captures the generated public URL and injects it through `.generated/runtime.env`
- Compose uses that generated env file for the current run only
- `./down.sh` stops the stack and removes the wrapper-managed quick tunnel container and generated files

This means the local stack is callback-capable by default for testing. Set
`MISTLE_APPS_CONTROL_PLANE_API_AUTH_BASE_URL` explicitly only when you want to override the quick
tunnel with a stable public URL.

This still mirrors the existing dev model:

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
