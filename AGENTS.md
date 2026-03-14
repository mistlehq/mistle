# General

## Dependencies & External APIs

- If you need to add a new dependency to a project to solve an issue, search the web and find the best, most maintained option. Something most other folks use with the best exposed API. We don't want to be in a situation where we are using an unmaintained dependency, that no one else relies on.

## Fallback Behavior

- Do not write fallback behavior unless the user explicitly asks for fallback behavior in this task.
- Never add fallback logic in application code unless the user explicitly asks for fallback behavior.
- Fail fast with explicit errors when required data/config/state is missing; do not silently switch to alternate paths, defaults, or inferred values.
- Implicit fallbacks make debugging significantly harder. If a fallback is explicitly approved, make it obvious in code and cover it with explicit tests.

## Testing Philosophy

- Strict rule: do **not** use mocking, stubbing, faking, or simulated behavior in tests.
- Disallowed mocking APIs include `vi.fn`, `vi.spyOn`, `vi.mock`, `jest.*`, `sinon`, `nock`, `msw`, and equivalent libraries.
- Disallowed manual doubles include `Fake*`, `Stub*`, `Noop*`, in-memory replacements of external systems, and any test-only implementation that simulates behavior not exercised in production.
- Disallowed assertion style includes interaction assertions on doubles (for example `toHaveBeenCalled*`). Assert observable behavior instead (HTTP response, persisted state, emitted events, UI output).
- Do not use fake timers or patched global time (`Date`, timers, `setSystemTime`, etc.). For time-sensitive behavior, use explicit injected dependencies from `@mistle/time` (for example `Clock` / `Sleeper` / `Scheduler`) and test with concrete deterministic implementations.
- Prefer real boundaries: pure unit tests for pure logic only; all dependency-bearing behavior should be covered by integration/system/e2e tests against real dependencies.
- Read `docs/testing/no-mocking.md` before adding or changing tests.
- Test **everything**. Tests must be rigorous. Our intent is ensuring a new person contributing to the same code base cannot break our stuff and that nothing slips by.
- Unless the user asks otherwise, run only the tests you added or modified instead of the entire suite to avoid wasting time.
- Unit tests should be colocated / close to the source code and scoped to pure function/class/module behavior (no external dependencies)
- Integration tests should be in a dedicated integration/ folder for a given app or package.
- System tests should be in a tests/system/ folder.
- E2E tests should be in a tests/e2e/ folder.

### Property-Based Testing

- Name property-based test files `*.property.test.ts` and colocate them with the unit-tested module.
- Use `fast-check` with Vitest via `@fast-check/vitest`.
- Keep property tests deterministic and replayable. Failures must expose enough information (seed/path) to reproduce locally.
- Use explicit generator bounds (length/depth/size) and avoid heavy `.filter(...)` usage that can make shrinking slow or brittle.
- Assert meaningful invariants (for example idempotence, associativity, round-trip behavior, canonical ordering, or no mutation) instead of restating implementation details.
- Set explicit per-property run budgets with `{ numRuns: ... }` and use pragmatic defaults unless risk justifies higher counts.
- For bug fixes, include a regression test derived from the minimized counterexample (as a property or targeted example test).

### Test Guidance

**Integration tests** (`*.integration.test.ts`):

- Test a **single app/service** in isolation with its real dependencies (database, etc.)
- Integration tests may include other services, but those dependencies must run out-of-process (containers/services), never in-process imports that blur boundaries
- Import and call the app's code directly (e.g., `import { createApp } from "@mistle/control-plane-api/app.js"`)
- Located in `apps/*/integration/` folders
- Use real infrastructure (Postgres, etc.) but test the app as a unit
- **Infrastructure:** Prefer Testcontainers for databases and other dependencies. Compose custom stacks using service primitives from `@mistle/test-harness` (for example `startPostgresWithPgBouncer()`) or use `PostgreSqlContainer` from `@testcontainers/postgresql` directly. Start containers in test setup/`beforeAll` and stop them in teardown/`afterAll`. Only spin up what your test needs (e.g., just Postgres for database tests, Postgres + Restate for tests that need both).
- Example: Testing auth routes by importing `createApp()` and making requests to it, verifying database state

**System tests** (`*.system.test.ts`):

- Test **multiple services** working together via HTTP
- Make HTTP requests to running services (do not import service code directly)
- Located in `tests/system/` folder
- Require services to be running and accessible via URLs (e.g., `CONTROL_PLANE_BASE_URL`, `DATA_PLANE_BASE_URL`)
- **Infrastructure:** Services are typically started via Testcontainers by composing `@mistle/test-harness` primitives (for example app launchers in `src/apps/*` plus backing services). Tests receive service URLs via environment variables.
- Example: Testing that control-plane, data-plane, and restate services all respond to health checks

**E2E tests** (`*.e2e.test.ts`):

- Test **full user flows** through the browser using Playwright
- Located in `tests/e2e/` for cross-cutting flows, or `apps/*/e2e/` for app-specific flows
- Require the full stack to be running and accessible via public URLs
- Interact with the UI as a real user would (clicking buttons, filling forms, etc.)
- **Infrastructure:** Compose full-stack dependencies using `@mistle/test-harness` and Testcontainers (or equivalent repo-level scripts) so browser tests run against real services.
- Example: Testing the complete email OTP auth login flow from browser navigation through code verification to dashboard rendering

**When to use which:**

- Use **integration tests** when testing a single app's functionality with its dependencies
- Use **system tests** when testing service-to-service interactions or multi-service health
- Use **E2E tests** when testing user-facing flows that require browser interaction
- Use **property-based tests** for pure, input-rich logic where invariants across generated inputs provide stronger coverage than a small fixed set of examples
- If a test requires external dependencies (database, network service, subprocess/container), it is not a unit test and should be moved to integration or above

**Infrastructure with Testcontainers:**

- **Prefer Testcontainers for infrastructure in tests.** It provides isolated, reproducible infrastructure that matches production without requiring pre-configured services or shared state.
- **Benefits:** Isolation (fresh infrastructure per test run), reproducibility (works the same locally and in CI), production-like (real infrastructure, not mocks), parallelization (multiple suites can run in parallel without conflicts).
- **When Testcontainers might not be needed:** Unit tests that are pure (no infrastructure), or CI environments where equivalent real infrastructure is already provisioned and isolated for the run.

### Testing Exceptions

- No exceptions by default.
- If a user explicitly directs an exception in a task, keep it minimal and temporary, add an inline justification comment with a cleanup owner and date, and avoid broad policy carve-outs.

### Snapshot Guidance

- Treat snapshots as approval artifacts, not convenience.
- Update snapshots only when changes are intentional and reviewed.
- Avoid full, noisy snapshots when targeted assertions cover the risk.
- When updating snapshots, explain the reason in the PR.

## Workflows

- Always run these scripts (in this order): `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test`.
- Before pushing, run `pnpm run ci` to mirror CI's end-to-end checks locally.
- Do not use `--no-verify` for commits or pushes; fix the underlying hook failure instead.
- Always commit using Conventional Commits (e.g. `feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`). Do not use any other format.
- Prefer small commits; break changes up into multiple commits if you need to, group related work together.

## Database Migrations

- We use Drizzle; generate migrations only with `drizzle-kit`.
- Never handwrite migrations.
- Use the migration generation and application scripts in `apps/control-plane-api/package.json`.

## Database Conventions

- Prefer Drizzle's relational query API (`database.query.<table>.findFirst/findMany`) over raw `database.select(...)` unless you need SQL-level control.
- In relational queries, prefer clause operator helpers from callback context (for example `where: (table, { eq, and }) => ...`) instead of importing operators directly from `drizzle-orm`.
- Prefer `typeid` identifiers over UUIDs for application-generated IDs, and use the app's shared ID helper module (for control-plane-api, `src/lib/ids.ts`) instead of calling `typeid-js` directly.
- Prefer database-native timestamps for persisted rows: use schema defaults like `.defaultNow()` or SQL primitives like `sql\`now()\``instead of`new Date()` values in insert/update payloads.

### Pull Requests

- GH CLI is available; you can open a PR with it when needed.
- If creating or updating a GitHub PR, use the `github-pr-authoring` skill.
- Before opening a PR, ensure your branch is rebased onto the latest `main` (for example: `git fetch origin main && git rebase origin/main`).
- If you open a PR, you must monitor its CI and address issues until the PR is green, unless the failure requires human intervention (e.g. missing GitHub secrets). Do not hack or workaround CI failures.

## Language Guidance

### File Naming

- For `apps/dashboard`, all files and folders must use kebab-case names.
- Exception: `apps/dashboard/README.md` is allowed as-is.
- This is enforced by dashboard lint via `apps/dashboard/lint/check-file-names.ts`.

### TypeScript

- `any` and `as` are forbidden.
- For identifier registries and constants maps, use PascalCase object names with UPPER_SNAKE_CASE keys (for example `AppIds.CONTROL_PLANE_API`), not camelCase key access patterns.
- Check `node_modules` for external API type definitions instead of guessing.
- **NEVER use inline imports** - no `await import("./foo.js")`, no `import("pkg").Type` in type positions, no dynamic imports for types. Always use standard top-level imports.
- NEVER remove or downgrade code to fix type errors from outdated dependencies; upgrade the dependency instead.
- Always ask before removing functionality or code that appears to be intentional.
- If the app is for a browser, assume we use all modern browsers unless otherwise specified, we don't need most polyfills.
- Avoid IIFEs; use module scope or named functions for one-off initialization.
- Avoid unnecessary inline closures, especially in hot paths or render loops; prefer named functions when it improves clarity or stable references. Closures are fine when they make intent clearer.

#### React Compiler

- Follow the Rules of React; compiler optimizations are skipped when rules are violated.
- Keep renders pure (no side effects or mutations during render).
- Use `/* @__NO_COMPILE__ */` on functions that must not be compiled.
