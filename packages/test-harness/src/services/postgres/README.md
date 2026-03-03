# Postgres + PgBouncer Service

Starts and manages a Postgres container plus a PgBouncer container for tests.

This service intentionally exposes two connection strings:

- `directUrl` for migrations/setup/DDL
- `pooledUrl` for application runtime workloads

## Exports

From [`index.ts`](./index.ts):

- `startPostgresWithPgBouncer(input?)`
- `PostgresWithPgBouncerService`
- `StartPostgresWithPgBouncerInput`

## Why Two URLs

Use different connection paths for different responsibilities:

- Migrations should use `directUrl` (Postgres directly).
- Operational app traffic should use `pooledUrl` (PgBouncer).

This prevents migration behavior from being affected by pooling mode while keeping runtime connection management realistic.

## Usage Pattern

```ts
import { startPostgresWithPgBouncer } from "@mistle/test-harness";

const database = await startPostgresWithPgBouncer();

// 1) apply migrations with database.directUrl
// 2) start app using database.pooledUrl

await database.stop();
```

## Input Options

`startPostgresWithPgBouncer(input?)` supports:

- `databaseName`
- `username`
- `password`
- `startupTimeoutMs`
- `poolMode` (`"session" | "transaction" | "statement"`)
- `defaultPoolSize`
- `maxClientConnections`

## Lifecycle

- Startup waits until both direct and pooled SQL paths accept queries.
- `stop()` is required.
- Calling `stop()` twice throws.
- No fallback behavior is applied for startup/teardown failures.
