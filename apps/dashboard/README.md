# @mistle/dashboard

Minimal dashboard scaffold using Vite + React.

## Included

- Vite build/dev/test baseline
- React app entrypoint with an empty `App`
- `@mistle/ui` stylesheet wiring in `src/index.css`
- Dashboard dependency scaffold for upcoming OpenAPI/client generation hookup

## Control Plane OpenAPI Client

- Source spec:
  - `../control-plane-api/openapi/control-plane.v1.json`
- Generate client schema:
  - `pnpm --filter @mistle/dashboard openapi:generate`
- Check for drift:
  - `pnpm --filter @mistle/dashboard openapi:check`
