---
name: db-migrations
description: Generate, review, and apply PostgreSQL database migrations for this repository using Drizzle. Use when Codex changes schema files under `packages/db/src/control-plane/schema` or `packages/db/src/data-plane/schema`, needs to add or inspect migrations under `packages/db/migrations`, needs to run either the control-plane or data-plane migration runner exposed by the app packages, or is asked how database migrations work in this repo.
---

# Db Migrations

Follow the repo's database migration workflow exactly. Keep migration generation schema-first, let Drizzle write migration artifacts, and apply them through the app scripts for the matching plane.

## Workflow

1. Determine which plane the migration belongs to.
   Use `control-plane` for schema changes under `packages/db/src/control-plane/schema/**` and migration files under `packages/db/migrations/control-plane/**`.
   Use `data-plane` for schema changes under `packages/db/src/data-plane/schema/**` and migration files under `packages/db/migrations/data-plane/**`.
2. Make schema changes first in the matching schema directory.
3. Generate the migration from the repository root with Drizzle and always provide a descriptive kebab-case name.
   For control-plane:

```bash
pnpm --filter @mistle/db exec drizzle-kit generate --config packages/db/drizzle.control-plane.config.ts --name add-descriptive-change-name
```

   For data-plane:

```bash
pnpm --filter @mistle/db exec drizzle-kit generate --config packages/db/drizzle.data-plane.config.ts --name add-descriptive-change-name
```

4. Review the generated files in the matching `packages/db/migrations/<plane>/` directory.
   Expect a new `NNNN_<descriptive-kebab-name>.sql`, a new `meta/*_snapshot.json`, and an updated `meta/_journal.json`.
5. Apply the migration through the matching app script.
   For control-plane:

```bash
pnpm --filter @mistle/control-plane-api db:migrate
```

   For data-plane:

```bash
pnpm --filter @mistle/data-plane-api db:migrate
```

## Rules

- Generate migrations only with `drizzle-kit`.
- Migrations must be named. Pass `--name` and use a short descriptive kebab-case name that matches the schema change.
- Never handwrite migration SQL, `meta/_journal.json`, or snapshot files.
- Use the migration application script exposed by the matching app package; do not bypass it with an ad hoc runner for normal migration tasks.
- If the migrator reports a missing journal file, generate the migration first instead of trying to patch migration metadata manually.
- Prefer adding a new migration over rewriting committed migration history. Only edit historical migrations when the user explicitly asks.

## Validation

Run the smallest relevant checks for the migration change:

For control-plane changes:

```bash
pnpm --filter @mistle/control-plane-api typecheck
```

For data-plane changes:

```bash
pnpm --filter @mistle/data-plane-api typecheck
```

If the change adds or modifies migration SQL files, also run the existing Squawk-backed SQL lint command:

```bash
pnpm lint:sql
```

`pnpm lint:sql` is the repo alias for `pnpm --filter @mistle/db lint:sql`.

Run broader repo checks when the task changes more than migration artifacts or when the user asks for full verification.
