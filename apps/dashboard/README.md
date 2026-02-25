# @mistle/dashboard

Minimal dashboard scaffold using Vite + React.

## Included

- Vite build/dev/test baseline
- Public assets from `mistle` (`public/favicon.ico`, `public/apple-touch-icon.png`, `public/brand/logo.webp`)
- OTP auth flow scaffold (`/auth/login`) backed by Better Auth
- Protected dummy page scaffold (`/`) shown after successful OTP login
- `@mistle/ui` stylesheet wiring in `src/index.css`
- Dashboard dependency scaffold for upcoming OpenAPI/client generation hookup

## Dashboard Config

- Build config uses the shared root config files:
  - `config/config.development.toml` for `pnpm --filter @mistle/dashboard dev`
  - `config/config.production.toml` for `pnpm --filter @mistle/dashboard build` and `preview`
- Override config file path by setting:
  - `MISTLE_CONFIG_PATH`
- Required key:
  - `apps.dashboard.control_plane_api_origin`

## Control Plane OpenAPI Client

- Source spec:
  - `../control-plane-api/openapi/control-plane.v1.json`
- Generate client schema:
  - `pnpm --filter @mistle/dashboard openapi:generate`
- Check for drift:
  - `pnpm --filter @mistle/dashboard openapi:check`
