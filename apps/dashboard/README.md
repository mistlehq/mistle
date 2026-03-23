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
  - default precedence when `MISTLE_CONFIG_PATH` is unset:
    1. `config/config.development.toml`
    2. `config/config.production.toml`
  - this applies for `dev`, `build`, and `preview`
- CI should pass `MISTLE_CONFIG_PATH` (for example `config/config.ci.toml`) instead of relying on production defaults.
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

## Sandbox Session Protocol

- Shared package:
  - `../packages/sandbox-session-protocol`

## Storybook Boundary

- Keep dashboard stories colocated in `src/**` as `*.stories.tsx`.
- The dashboard app tsconfig excludes `*.stories.tsx`, `*.story-fixtures.ts`, `*.story-fixtures.tsx`, and `src/storybook/**`.
- Storybook-specific validation belongs to `@mistle/storybook`, not the dashboard runtime typecheck.
- Prefer neutral fixtures for sample data shared by stories and tests.
- Keep Storybook-only composition in `*.story-fixtures.ts` or `*.story-fixtures.tsx`.
- Do not import story-only fixtures from dashboard tests.
