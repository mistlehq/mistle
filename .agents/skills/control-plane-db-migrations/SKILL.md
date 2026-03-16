---
name: control-plane-db-migrations
description: Generate, review, and apply control-plane PostgreSQL migrations for this repository using Drizzle. Use when Codex changes control-plane schema files, needs to add or inspect a migration under `packages/db/migrations/control-plane`, needs to run the control-plane migration runner exposed by `apps/control-plane-api`, or is asked how control-plane database migrations work in this repo.
---

# Control Plane Db Migrations

Follow the repo's control-plane migration workflow exactly. Keep migration generation schema-first, let Drizzle write migration artifacts, and apply them through the control-plane app script.

## Workflow

1. Confirm the task is about the control-plane schema.
   Use this skill for `packages/db/src/control-plane/schema/**`, `packages/db/migrations/control-plane/**`, and control-plane migration execution via `apps/control-plane-api`.
   If the task is about data-plane migrations, inspect the data-plane config and scripts instead of reusing this workflow blindly.
2. Make schema changes first in `packages/db/src/control-plane/schema/**`.
3. Generate the migration from the repository root with Drizzle and always provide a descriptive kebab-case name:

```bash
pnpm --filter @mistle/db exec drizzle-kit generate --config packages/db/drizzle.control-plane.config.ts --name add-descriptive-change-name
```

4. Review the generated files in `packages/db/migrations/control-plane/`.
   Expect a new `NNNN_<descriptive-kebab-name>.sql`, a new `meta/*_snapshot.json`, and an updated `meta/_journal.json`.
5. Apply the migration through the control-plane app script:

```bash
pnpm --filter @mistle/control-plane-api db:migrate
```

## Rules

- Generate migrations only with `drizzle-kit`.
- Migrations must be named. Pass `--name` and use a short descriptive kebab-case name that matches the schema change.
- Never handwrite migration SQL, `meta/_journal.json`, or snapshot files.
- Use the migration application script exposed by `apps/control-plane-api/package.json`; do not bypass it with an ad hoc runner for normal control-plane migration tasks.
- If the migrator reports a missing journal file, generate the migration first instead of trying to patch migration metadata manually.
- Prefer adding a new migration over rewriting committed migration history. Only edit historical migrations when the user explicitly asks.

## Validation

Run the smallest relevant checks for the migration change:

```bash
pnpm --filter @mistle/control-plane-api typecheck
```

If the change adds or modifies migration SQL files, also run the existing Squawk-backed SQL lint command:

```bash
pnpm lint:sql
```

`pnpm lint:sql` is the repo alias for `pnpm --filter @mistle/db lint:sql`.

Run broader repo checks when the task changes more than migration artifacts or when the user asks for full verification.
