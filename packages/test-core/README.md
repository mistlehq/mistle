# @mistle/test-core

Real test infrastructure for integration, system, and e2e tests.

This package is for test-time dependency orchestration (containers + service clients), so apps can test real boundaries without mocks/stubs/fakes.

For composed backend environments, use `@mistle/test-environments`.

## Public API

Exported from [`src/index.ts`](./src/index.ts):

- `startMailpit`
- `MailpitService`
- `startPostgresWithPgBouncer`
- `PostgresWithPgBouncerService`
- `reserveAvailablePort`

## Service Modules

- [Mailpit service](./src/services/mailpit/README.md)
- [Postgres + PgBouncer service](./src/services/postgres/README.md)

As more services are added, each service should include its own `README.md` with focused setup and usage examples.

## Scripts

- `pnpm --filter @mistle/test-core build`
- `pnpm --filter @mistle/test-core lint`
- `pnpm --filter @mistle/test-core typecheck`
- `pnpm --filter @mistle/test-core test`
- `pnpm --filter @mistle/test-core format`
- `pnpm --filter @mistle/test-core format:check`
