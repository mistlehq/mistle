# Mistle

User-facing documentation will be added here.

## Deployment Packaging

Kubernetes application packaging for Mistle lives under:

- `deploy/helm/mistle/`

Use this chart to deploy Mistle on Kubernetes.

For repo-local Helm smoke testing against OrbStack and the compose-backed
development dependencies, start from:

- `deploy/helm/mistle/values-local.yaml`

## For Developers

Local development is Nix-first.

Repo runtime expectation:

- Node v25
- pnpm 10.30.2
- Rust stable with `cargo`, `rustfmt`, and `clippy`

### Prerequisites

- Nix with flakes enabled
- Docker (Desktop or Engine) with `docker compose`
- Optional: `direnv` + `nix-direnv` for automatic shell activation

If you are not using the Nix shell, install Node v25, pnpm 10.30.2, and a Rust toolchain with `cargo`, `rustfmt`, and `clippy` locally.

### Install Nix

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

### First-Time Setup

1. Enter the development shell:

```bash
nix develop
```

2. Install dependencies:

```bash
pnpm install
```

3. Copy and configure local development environment values:

```bash
cp sample.env.dev .env.dev
```

`.env.dev` is for local tooling and developer-only values needed by `pnpm dev` (for example tunnel tokens and public tunnel hostnames). Application runtime configuration should be set in `config/*.toml` and loaded via `MISTLE_CONFIG_PATH`, not stored in `.env.dev`.

Optional test-only secrets and opt-in test toggles belong in a separate file:

```bash
cp sample.env.test .env.test
```

`.env.test` is only for manual test inputs such as `MISTLE_TEST_OPENAI_API_KEY`, `MISTLE_TEST_GITHUB_TOKEN`, `MISTLE_TEST_GITHUB_TEST_REPOSITORY`, `MISTLE_TEST_GITHUB_INSTALLATION_ID`, and sandbox integration toggles like `MISTLE_TEST_SANDBOX_INTEGRATION`. Generated integration and system test runtime context is written under `.local/test-context/*.json` during suite setup and should not be added to `.env.test`.

4. Create a Cloudflare named tunnel (one-time):

```bash
cloudflared tunnel create <tunnel-name>
```

5. Create DNS routes for stable public hostnames:

```bash
cloudflared tunnel route dns <tunnel-name> <control-plane-api-hostname>
cloudflared tunnel route dns <tunnel-name> <data-plane-api-hostname>
```

Example naming:

- `<tunnel-name>`: `mistle-<your-suffix>`
- `<control-plane-api-hostname>`: `control-plane-api-<your-suffix>.<your-zone>`
- `<data-plane-api-hostname>`: `data-plane-api-<your-suffix>.<your-zone>`

6. Fill required tunnel values in `.env.dev`:

```bash
cloudflared tunnel token <tunnel-name>
```

```env
CLOUDFLARE_TUNNEL_TOKEN=<token-from-command-above>
CONTROL_PLANE_API_TUNNEL_HOSTNAME=<control-plane-api-hostname>
DATA_PLANE_API_TUNNEL_HOSTNAME=<data-plane-api-hostname>
```

7. Start the stack:

```bash
pnpm dev
```

`pnpm dev` brings up local infra (Postgres, PgBouncer, Mailpit, local registry), runs control-plane migrations, and starts a named Cloudflare tunnel with stable hostnames.

### Daily Workflow

```bash
nix develop
pnpm dev
```

Dev command summary:

| Command               | What it does                                                                                                                                                |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`            | Starts local infra and app dev processes. On stop, runs compose `down --remove-orphans` (keeps volumes and images), so Postgres and registry state persist. |
| `pnpm dev:down`       | Stops/removes containers and network. Keeps volumes and images.                                                                                             |
| `pnpm dev:reset`      | Same as `dev:down`, then removes compose volumes (wipes Postgres + local registry state).                                                                   |
| `pnpm dev:reset:hard` | Same as `dev:reset`, then removes local compose images.                                                                                                     |

### Optional Direnv

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
pnpm typecheck
pnpm test
```
