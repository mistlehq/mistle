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

4. Fill `CLOUDFLARE_TUNNEL_TOKEN` in `.env.local`:

```bash
cloudflared tunnel token <tunnel-name-or-id>
```

5. Start the stack:

```bash
pnpm dev
```

`pnpm dev` brings up local infra (Postgres, PgBouncer, Caddy, Mailpit), runs control-plane migrations, and starts a named Cloudflare tunnel with stable hostnames.

### Daily Workflow

```bash
nix develop
pnpm dev
```

To stop local infra:

```bash
pnpm dev:down
```

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
