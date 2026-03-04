# Mistle

User-facing documentation will be added here.

## For Developers

Local development is Nix-first.

### Prerequisites

- Nix with flakes enabled
- Docker (Desktop or Engine) with `docker compose`
- Optional: `direnv` + `nix-direnv` for automatic shell activation

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

3. Copy and configure local environment values:

```bash
cp sample.env.local .env.local
```

`.env.local` is for local tooling and developer secrets only (for example tunnel tokens, or opt-in test toggles like `MISTLE_SANDBOX_INTEGRATION` and `MISTLE_SANDBOX_INTEGRATION_PROVIDERS`). Application runtime configuration should be set in `config/*.toml` and loaded via `MISTLE_CONFIG_PATH`, not stored in `.env.local`.

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

6. Fill required tunnel values in `.env.local`:

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

To stop local infra:

```bash
pnpm dev:down
```

To reset local infra state (including Postgres + local registry volumes):

```bash
pnpm dev:reset
```

To reset local infra state and remove local compose images:

```bash
pnpm dev:reset:hard
```

Behavior summary:

- `pnpm dev`: starts local infra and app dev processes. On stop, it runs compose `down` without deleting volumes, so Postgres and registry state persist.
- `pnpm dev:down`: stops/removes containers and network, keeps volumes and images.
- `pnpm dev:reset`: same as `dev:down` plus removes compose volumes (wipes Postgres + local registry state).
- `pnpm dev:reset:hard`: same as `dev:reset` plus removes local compose images.

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

This repo includes `.envrc` to auto-enter the flake shell and load `.env.local`.

### Validation

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm test
```
