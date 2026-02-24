# @mistle/db

Database package for Mistle.

Current layout:

- `src/control-plane`
- `src/data-plane`
- `src/migrator`
- `src/testing`

Control-plane currently includes Better Auth tables:

- `users`
- `sessions`
- `accounts`
- `verifications`
- `organizations`
- `members`
- `teams`
- `team_members`
- `invitations`

It also exports:

- `ControlPlaneSchema`
- `createControlPlaneDatabase(pool)`

Generated Drizzle migrations should live in:

- `migrations/control-plane`
- `migrations/data-plane`

Drizzle config files:

- `drizzle.control-plane.config.ts`
- `drizzle.data-plane.config.ts`

These configs are schema-first and do not require a database URL for
`drizzle-kit generate`.

Commands that connect to a real database (for example `push`/`pull`) should
provide connection credentials explicitly at execution time.

SQL linting:

- `pnpm --filter @mistle/db lint:sql`
- Root alias: `pnpm lint:sql`
