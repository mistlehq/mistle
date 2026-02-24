# @mistle/test-harness

Real test infrastructure for integration, system, and e2e tests.

This package is for test-time dependency orchestration (containers + service clients), so apps can test real boundaries without mocks/stubs/fakes.

## Public API

Exported from [`src/index.ts`](./src/index.ts):

- `startMailpit`
- `MailpitService`

## Service Modules

- [Mailpit service](./src/services/mailpit/README.md)

As more services are added, each service should include its own `README.md` with focused setup and usage examples.

## Scripts

- `pnpm --filter @mistle/test-harness build`
- `pnpm --filter @mistle/test-harness lint`
- `pnpm --filter @mistle/test-harness typecheck`
- `pnpm --filter @mistle/test-harness test`
- `pnpm --filter @mistle/test-harness format`
- `pnpm --filter @mistle/test-harness format:check`
