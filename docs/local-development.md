# Local Development

## Overview

Local development for Mistle is Nix-first and assumes a multi-service environment with Docker-backed dependencies.

Repo runtime expectation:

- Node v25
- pnpm 10.30.2
- Rust stable with `cargo`, `rustfmt`, and `clippy`

## Prerequisites

- Nix with flakes enabled
- Docker (Desktop or Engine) with `docker compose`
- Optional: `direnv` + `nix-direnv` for automatic shell activation

If you are not using the Nix shell, install Node v25, pnpm 10.30.2, a Rust toolchain with `cargo`, `rustfmt`, and `clippy`, and `typos-cli` locally.

## First-Time Setup

1. Enter the development shell:

```bash
nix develop
```

2. Install dependencies:

```bash
pnpm install
```

3. Copy local environment files:

```bash
cp sample.env.dev .env.dev
cp sample.env.test .env.test
```

4. Create a named Cloudflare tunnel and DNS routes:

```bash
cloudflared tunnel create <tunnel-name>
cloudflared tunnel route dns <tunnel-name> <control-plane-api-hostname>
cloudflared tunnel route dns <tunnel-name> <data-plane-gateway-hostname>
cloudflared tunnel route dns <tunnel-name> <tokenizer-proxy-hostname>
```

5. Fill the required tunnel values in `.env.dev`:

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

`pnpm dev` brings up local infra, runs control-plane migrations, and starts a named Cloudflare tunnel with stable hostnames.

## Daily Workflow

```bash
nix develop
pnpm dev
```

Dev command summary:

| Command               | What it does                                                                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm dev`            | Starts local infra and app dev processes. On stop, runs compose `down --remove-orphans` and keeps volumes and images so Postgres and registry state persist. |
| `pnpm dev:down`       | Stops and removes containers and network. Keeps volumes and images.                                                                                          |
| `pnpm dev:reset`      | Same as `dev:down`, then removes compose volumes and wipes Postgres and local registry state.                                                                |
| `pnpm dev:reset:hard` | Same as `dev:reset`, then removes local compose images.                                                                                                      |

## Environment Files

`.env.dev` is for local tooling and developer-only values needed by `pnpm dev` such as tunnel tokens and public tunnel hostnames. Application runtime configuration should be set in `config/*.toml` and loaded via `MISTLE_CONFIG_PATH`, not stored in `.env.dev`.

`.env.test` is only for manual test inputs such as `MISTLE_TEST_OPENAI_API_KEY`, `MISTLE_TEST_GITHUB_TOKEN`, `MISTLE_TEST_GITHUB_TEST_REPOSITORY`, `MISTLE_TEST_GITHUB_INSTALLATION_ID`, and sandbox integration toggles like `MISTLE_TEST_SANDBOX_INTEGRATION`. Generated integration and system test runtime context is written under `.local/test-context/*.json` during suite setup and should not be added to `.env.test`.

Example naming:

- `<tunnel-name>`: `mistle-<your-suffix>`
- `<control-plane-api-hostname>`: `control-plane-api-<your-suffix>.<your-zone>`
- `<data-plane-gateway-hostname>`: `data-plane-gateway-<your-suffix>.<your-zone>`
- `<tokenizer-proxy-hostname>`: `tokenizer-proxy-<your-suffix>.<your-zone>`

## Install Nix

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

## Optional Direnv

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

## Validation

```bash
pnpm format
pnpm lint
pnpm lint:spelling
pnpm typecheck
pnpm test
```

Testing guidance:

- [docs/testing/no-mocking.md](testing/no-mocking.md)
- [docs/testing/property-based-testing.md](testing/property-based-testing.md)
