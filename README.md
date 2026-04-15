# Mistle

Mistle is an open-source platform for building and running sandboxed coding agents.

## How Mistle Works

- **Integrations** connect external systems and models such as GitHub, Slack, and OpenAI.
- **Sandbox profiles** define the tools, permissions, and environment an agent starts with.
- **Sessions** start interactive agent work such as debugging, code review, and repository changes.
- **Automations** respond to external events, such as webhook deliveries from connected systems.

## Architecture

Mistle is split into control-plane and data-plane services.

- **Separate configuration from execution:** The dashboard, control-plane APIs, and control-plane workflows manage integrations, sandbox profiles, sessions, and automation setup, while data-plane APIs and workflows handle sandbox startup, lifecycle, and runtime execution.
- **Treat runtime traffic as a dedicated path:** The data-plane gateway handles sandbox tunnels, token exchange, runtime-state access, interactive stream routing, and other runtime connectivity concerns.
- **Tokenizer proxy:** The tokenizer proxy is the sandbox egress service. It mediates outbound requests from runtime environments, enforces egress grants and route policy, and resolves and injects integration credentials before forwarding traffic to upstream systems.

```text
+--------------------------------------------------------------+
|                        Control Plane                         |
|  dashboard | control-plane-api | control-plane-worker        |
+--------------------------------------------------------------+
                              |
                              | starts / configures work
                              v
+--------------------------------------------------------------+
|                          Data Plane                          |
|  data-plane-api | data-plane-worker | data-plane-gateway     |
+--------------------------------------------------------------+
                              |
                              | provisions / connects runtime
                              v
+--------------------------------------------------------------+
|                Sandbox / Runtime Environment                 |
|               agent runtime | filesystem | tools             |
+--------------------------------------------------------------+
                |                                |
                | runtime connectivity           | outbound requests
                v                                v
        data-plane-gateway                tokenizer-proxy
                                                 |
                                                 | egress grants +
                                                 | route policy +
                                                 | credential injection
                                                 v
                              GitHub / Slack / Jira / SigNoz / OpenAI
```

## Security Model

Mistle is built around isolated agent execution and explicit configuration.

- **Sandboxed execution:** Coding agents run in sandboxed environments.
- **Explicit configuration:** Sandbox profiles define the tools, permissions, environment settings, and agent configuration available to each run.
- **Separated runtime services:** Control-plane services handle configuration and orchestration, while runtime execution is delegated to data-plane and sandbox-related services.
- **Integration boundaries:** Access to external systems is provided through configured integrations.
- **Controlled outbound access:** External requests from runtime environments flow through the tokenizer proxy, which enforces egress grants, route policy, and credential injection before forwarding traffic upstream.

## Local Development

### Overview

Local development for Mistle requires Nix and uses a multi-service environment with Docker-backed dependencies.

Repo runtime provided by `nix develop`:

- Node v25
- pnpm 10.30.2
- Rust stable with `cargo`, `rustfmt`, and `clippy`

### Prerequisites

- **Required:** Nix with flakes enabled
- **Required to run the local dependency stack:** Docker (Desktop or Engine) with `docker compose`
- **Required for stable public hostnames in local development:** `cloudflared`
- **Required for tunnel setup:** access to the Cloudflare account and zone you want to use
- **Required for tunnel setup:** permission to create named tunnels and DNS routes
- **Optional:** `direnv` + `nix-direnv` for automatic shell activation

### Setup

1. Enter the development shell:

```bash
nix develop
```

2. Install dependencies:

```bash
pnpm install
```

3. Create `config/config.development.toml`:

```bash
pnpm config:init:dev
```

4. Copy local environment files:

```bash
cp sample.env.dev .env.dev
cp sample.env.test .env.test
```

5. Complete the Cloudflare tunnel setup.

Example naming:

- `<tunnel-name>`: `mistle-<your-suffix>`
- `<control-plane-api-hostname>`: `control-plane-api-<your-suffix>.<your-zone>`
- `<data-plane-gateway-hostname>`: `data-plane-gateway-<your-suffix>.<your-zone>`
- `<tokenizer-proxy-hostname>`: `tokenizer-proxy-<your-suffix>.<your-zone>`

Choose hostnames for the control-plane API, data-plane gateway, and tokenizer proxy, then create the tunnel and DNS routes:

```bash
cloudflared tunnel create <tunnel-name>
cloudflared tunnel route dns <tunnel-name> <control-plane-api-hostname>
cloudflared tunnel route dns <tunnel-name> <data-plane-gateway-hostname>
cloudflared tunnel route dns <tunnel-name> <tokenizer-proxy-hostname>
```

Fetch the tunnel token and place the required values in `.env.dev`:

```bash
cloudflared tunnel token <tunnel-name>
```

```env
CLOUDFLARE_TUNNEL_TOKEN=<token-from-command-above>
CONTROL_PLANE_API_TUNNEL_HOSTNAME=<control-plane-api-hostname>
DATA_PLANE_API_TUNNEL_HOSTNAME=<data-plane-gateway-hostname>
TOKENIZER_PROXY_TUNNEL_HOSTNAME=<tokenizer-proxy-hostname>
```

6. Start the stack:

```bash
pnpm dev
```

`pnpm dev` brings up local infra, runs control-plane and data-plane migrations, starts the public tunnels, and launches the workspace development processes.

7. Sync integration targets into the control-plane database:

```bash
pnpm --filter @mistle/control-plane-api integration-targets:sync
```

`integration-targets:sync` syncs built-in integration targets from the integration registry and can also provision target records from a manifest when one is available.

8. After startup:

- open the dashboard at `http://localhost:5173`
- review the available integration targets
- create or connect an integration
- create a sandbox profile
- start a session or configure an automation

`pnpm dev` also prints public tunnel URLs along with local Mailpit and Grafana endpoints for supporting services.

### Development Commands

| Command          | What it does                                                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm dev`       | Starts local infra and app dev processes. On stop, runs compose `down --remove-orphans` and keeps volumes and images so Postgres and registry state persist. |
| `pnpm dev:down`  | Stops and removes containers and network. Keeps volumes and images.                                                                                          |
| `pnpm dev:reset` | Same as `dev:down`, then removes compose volumes and wipes Postgres and local registry state.                                                                |

### Environment Files

`.env.dev` is for local shell and development-process environment variables such as Cloudflare tunnel tokens and public tunnel hostnames. Application runtime configuration belongs in `config/*.toml` and is loaded via `MISTLE_CONFIG_PATH`, not from `.env.dev`.

`.env.test` is for manually supplied test credentials and other test-only inputs used by local and system test flows. Generated integration and system test runtime context is written under `.local/test-context/*.json` during suite setup and should not be added to `.env.test`.

### Reference

#### Install Nix

Nix installation docs:

- https://nixos.org/download/
- https://nix.dev/manual/nix/stable/installation/

macOS multi-user install:

```bash
sh <(curl -L https://nixos.org/nix/install) --daemon
```

Enable flakes:

```bash
echo "experimental-features = nix-command flakes" | sudo tee -a /etc/nix/nix.conf
```

Verify:

```bash
nix --version
nix config check
```

#### Optional Direnv

Install `direnv`:

- macOS (Homebrew): `brew install direnv`
- Nix: `nix profile add nixpkgs#direnv`

Install `nix-direnv`:

```bash
nix profile add nixpkgs#nix-direnv
mkdir -p ~/.config/direnv
echo 'source $HOME/.nix-profile/share/nix-direnv/direnvrc' >> ~/.config/direnv/direnvrc
```

Enable direnv in zsh:

```bash
echo 'eval "$(direnv hook zsh)"' >> ~/.zshrc
exec zsh
```

Allow this repo once:

```bash
direnv allow
```

This repo includes `.envrc` to auto-enter the flake shell and load `.env.dev`.

### Validation

```bash
pnpm format
pnpm lint
pnpm lint:spelling
pnpm typecheck
pnpm test
```

Testing guidance:

- [No Mocking](docs/testing/no-mocking.md)
- [Property-Based Testing](docs/testing/property-based-testing.md)

## Deployment

Mistle is deployed as a multi-service system. The repository includes Kubernetes packaging, but deployment still requires environment-specific decisions about infrastructure, networking, secrets, and exposure.

At a minimum, operators should expect to reason about:

- dashboard access
- control-plane APIs and workers
- data-plane APIs and workers
- gateway connectivity for runtime and session traffic
- supporting infrastructure such as databases, secrets, and environment configuration

Mistle should be treated as an integrated platform deployment rather than a single application process.

### Current Deployment Artifacts

- **Kubernetes:** `deploy/helm/mistle/` is the current deployment artifact in this repository.
- **Docker Compose:** `dev/docker-compose.yml` is for local development, not a generic self-hosting deployment.
- **Single-node deployment:** a standalone Docker Compose deployment artifact is still in progress.

### Kubernetes Packaging

Kubernetes application packaging for Mistle lives under:

- `deploy/helm/mistle/`

Use this chart as the starting point for Kubernetes-based deployment.

For repo-local Helm smoke testing against OrbStack and the compose-backed development dependencies, start from:

- `deploy/helm/mistle/values-local.yaml`

## Releases

- [Release process](docs/release-process.md)
