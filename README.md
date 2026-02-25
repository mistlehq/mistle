# Mistle

## Local Development (Nix-First)

### Prerequisites

- Nix with flakes enabled
- Docker (Desktop or Engine) with `docker compose`
- Optional: `direnv` + `nix-direnv` for automatic shell activation

### Setup

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
cloudflared tunnel token mistle-api-thomasjiang
```

5. Start the stack:

```bash
pnpm dev
```

`pnpm dev` brings up local infra (Postgres, PgBouncer, Caddy), runs control-plane migrations, and starts a named Cloudflare tunnel with stable hostnames.

### Optional Direnv

If you use direnv:

```bash
direnv allow
```

This repo includes `.envrc` to auto-enter the flake shell and load `.env.local`.

### Validate

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm test
```
