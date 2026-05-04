# Contributing to Mistle

Thanks for contributing to Mistle.

## Local Development

Local development for Mistle requires Nix and uses a multi-service environment with Docker-backed dependencies.

The contributor workflow in this repository is `pnpm dev`. If you want the separate single-node Docker Compose workflow for running Mistle on one machine outside the monorepo dev harness, use [deploy/compose/local/](deploy/compose/local/).

Repo runtime provided by `nix develop`:

- Node v25
- pnpm 10.30.2
- Rust stable with `cargo`, `rustfmt`, and `clippy`

### Prerequisites

- **Required:** Nix with flakes enabled
- **Required to run the local dependency stack:** Docker (Desktop or Engine) with `docker compose`
- **Required for stable public hostnames in the `pnpm dev` workflow:** `cloudflared`
- **Required for named-tunnel setup in the `pnpm dev` workflow:** access to the Cloudflare account and zone you want to use
- **Required for named-tunnel setup in the `pnpm dev` workflow:** permission to create named tunnels and DNS routes
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

- [No Mocking](docs/development/no-mocking.md)
- [Property-Based Testing](docs/development/property-based-testing.md)

## Contribution Process

- For bug reports and feature requests, open an issue first.
- We are not currently accepting general external pull requests.
- If you want to propose work, open an issue first so maintainers can discuss scope and whether a pull request is invited.
- For any invited pull request, keep the change focused, include context for reviewers, add or update tests when behavior changes, and ensure CI is passing before review.

## Contributor License Agreement (Individual)

Contributors must accept the CLA for any invited pull request.

Read the agreement at [CLA.md](CLA.md).

1. Confirm with maintainers that a pull request is invited.
2. Open your Pull Request.
3. Follow the CLA Assistant prompt on the pull request to complete signing.
4. The pull request can proceed after CLA status is satisfied.
