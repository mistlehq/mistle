# General

## Dependencies & External APIs

- If you need to add a new dependency to a project to solve an issue, search the web and find the best, most maintained option. Something most other folks use with the best exposed API. We don't want to be in a situation where we are using an unmaintained dependency, that no one else relies on.

## Fallback Behavior

- Do not write fallback behavior unless the user explicitly asks for fallback behavior in this task.
- Never add fallback logic in application code unless the user explicitly asks for fallback behavior.
- Fail fast with explicit errors when required data/config/state is missing; do not silently switch to alternate paths, defaults, or inferred values.
- Implicit fallbacks make debugging significantly harder. If a fallback is explicitly approved, make it obvious in code and cover it with explicit tests.

## Testing Philosophy

- Strict rule: do **not** use mocking, stubbing, faking, or simulated behavior in tests, except for the narrow simulated external-system rule below.
- Disallowed mocking APIs include `vi.fn`, `vi.spyOn`, `vi.mock`, `jest.*`, `sinon`, `nock`, `msw`, and equivalent libraries.
- Disallowed manual doubles include `Fake*`, `Stub*`, `Noop*`, in-memory replacements of external systems, and any test-only implementation that simulates behavior not exercised in production.
- Disallowed assertion style includes interaction assertions on doubles (for example `toHaveBeenCalled*`). Assert observable behavior instead (HTTP response, persisted state, emitted events, UI output).
- Do not use fake timers or patched global time (`Date`, timers, `setSystemTime`, etc.). For time-sensitive behavior, use explicit injected dependencies from `@mistle/time` (for example `Clock` / `Sleeper` / `Scheduler`) and test with concrete deterministic implementations.
- Prefer real boundaries: pure unit tests for pure logic only; all dependency-bearing behavior should be covered by integration/system/e2e tests against real dependencies.
- The only allowed simulated behavior is a small local HTTP simulator for a non-Mistle external system that cannot be used directly in CI. Name it honestly with `Simulated` / `Simulator`, keep it direct and scoped to the provider endpoints the test exercises, and never use it to replace a Mistle service, database, queue, worker, or runtime.
- Every simulated external-system endpoint, payload field, signature, status code, callback, or token response must be grounded in the provider's official documentation and/or our production integration code. Add source comments or links near the simulator behavior. Do not invent provider behavior from memory.
- Read `docs/development/no-mocking.md` before adding or changing tests.
- Test **everything**. Tests must be rigorous. Our intent is ensuring a new person contributing to the same code base cannot break our stuff and that nothing slips by.
- Do not write coverage theater. A test must protect a real behavior, contract, regression, or user/service workflow. Avoid tests that only prove code can be called, assert implementation trivia, duplicate another test at a different layer, or exercise impossible/corrupt state without a clear production risk.
- Test names should describe the behavior being protected, not the implementation detail being executed. A reviewer should be able to understand the scenario and expected outcome from the name plus the top-level test body.
- Prefer one clear behavior per test. If a test needs many unrelated assertions, split it unless the assertions are all part of the same observable scenario.
- Keep setup proportional to the behavior under test. Do not create large fixture graphs, start extra services, or seed unrelated rows just because a legacy test did.
- When porting legacy tests, reassess the value of each scenario. Preserve meaningful observable behavior, but drop or rewrite tests that are noisy, redundant, coupled to old harness mechanics, or only validate defensive failures for manually corrupted internal state.
- Unless the user asks otherwise, run only the tests you added or modified instead of the entire suite to avoid wasting time.
- For targeted Vitest runs, prefer direct exec forms that pass file paths directly to Vitest. Use `pnpm --filter <pkg> exec vitest run -c <config> <file>` for package-local runs, `pnpm --filter <pkg> exec vitest run -c vitest.component.config.ts <file>` for package-local component runs, `pnpm --filter <pkg> exec vitest run -c vitest.integration.config.ts <file>` for package-local integration debugging, and `pnpm test:integration -- --project <project> <file>` for the canonical root integration runner.
- In this repo, `pnpm --filter <pkg> test:integration -- <file>` does **not** reliably scope to that file. It forwards as `vitest run -c <config> -- <file>`, and Vitest treats that differently from a positional file filter. Use the direct `exec vitest ... <file>` form when you need a single-file package-level run.
- Unit tests should be colocated / close to the source code and scoped to pure function/class/module behavior (no external dependencies)
- Component tests should be colocated / close to the component or hook under test, named `*.component.test.ts` or `*.component.test.tsx`, and run through the package component Vitest config / `test:component` lane.
- Harness-backed app integration tests live in each app's integration/ folder. Package-level integration suites also live in integration/ folders for their package.
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

**Component tests** (`*.component.test.ts` / `*.component.test.tsx`):

- Test rendered UI components, React hooks, and browser/component behavior in jsdom without starting real app services.
- Use component tests when a test imports React Testing Library, renders React, uses `renderHook`, relies on Router or QueryClient providers, exercises browser DOM behavior, or asserts React-rendered/static component markup.
- Component tests may use real in-process component dependencies and provider setup, but they must not start databases, containers, local HTTP services, or the control plane/data plane. Tests that require those boundaries belong in integration, system, or E2E suites.
- Component tests must follow the no-mocking policy. Assert observable UI output, DOM state, navigation behavior, or hook state through real providers and real code paths.
- Keep component tests out of the unit lane. If a test needs jsdom, React rendering, component cleanup, QueryClient/Router provider behavior, or browser-only libraries such as CodeMirror, name it `*.component.test.ts[x]`.
- Run package component suites with `pnpm --filter <pkg> test:component`. For targeted runs, use `pnpm --filter <pkg> exec vitest run -c vitest.component.config.ts <file>`.
- Example: Testing that a form component renders validation errors, updates visible state after user input, or that a hook coordinates QueryClient-backed state through a real provider.

**Integration tests** (`*.integration.test.ts`):

- Test one app/service as the primary subject, but compose any real Mistle services that are required for the behavior under test.
- Integration tests may run multiple Mistle services. The boundary is the service process/API, not "exactly one app in memory". If the subject service normally talks to another service, prefer starting that service through `@mistle/test-harness` instead of replacing it with a test double.
- Do not import another app's runtime directly from an app integration test. Cross-service dependencies must be started through the test environment registry so the dependency runs as a real service.
- Before adding, changing, or migrating integration tests, read `packages/test-harness/src/environment/README.md`. It is the source of truth for the new integration harness API, fixture shape, service selection, runtime default, pooling behavior, and migration expectations.
- New app integration tests must use `@mistle/test-harness`. Use `createIntegrationTest(...)` from the harness; do not create app-local bespoke setup unless you are implementing harness support itself.
- `integration` is not limited to HTTP API tests. It is the required lane for dependency-bearing app/service behavior, whether the entrypoint is HTTP, a service/module function, a workflow, or another production code path. Choose the entrypoint that best matches the behavior under test.
- Prefer HTTP/API entrypoints when the public endpoint contract, authorization, validation, serialization, or emitted side effect is the behavior. Use a lower-level production service/module entrypoint when HTTP would add ceremony without improving the assertion and the behavior is genuinely below the API boundary.
- Do not spin up ad hoc HTTP servers, local handlers, or app-local doubles to emulate Mistle services. If a test needs a Mistle service, add/select that service through `createIntegrationTest(...)` so the real service runs with the harness-managed environment.
- Integration tests may use small simulated local HTTP servers only for external/non-Mistle systems, such as a provider API, provider callback endpoint, or arbitrary upstream echo server. Keep simulators file-local unless reuse is proven, name them explicitly (`startSimulatedGitHubApi`, `startSimulatedGoogleOAuthServer`), and document the official provider docs or production integration code that grounds the simulated behavior.
- `@mistle/test-harness` may dynamically import selected integration service implementations behind `createIntegrationTest(...)` so small tests do not transform every Mistle app and worker runtime before fixtures start. Keep this exception inside the harness service loader; app/test code should still use ordinary static imports.
- New integration tests must receive a single `{ env }` fixture. Do not expose many one-off fixture fields when they can be modeled under `env`.
- Runtime mode is the default for Mistle services in app integration tests. Do not use Docker mode for ordinary application behavior tests unless the test explicitly covers packaging/deployment-shape behavior.
- Request every live service the test intentionally exercises. Service references in the registry are wiring/order hints only; they must not surprise-start extra services.
- Keep test bodies at the scenario level: arrange the domain state, perform the user/service action, and assert the observable outcome. Move repetitive protocol mechanics, token minting, websocket choreography, polling, and cleanup into well-named file-local helpers so the test reads as behavior. Do not promote those helpers to public harness APIs until multiple real tests prove the abstraction is stable.
- Prefer `describe.concurrent(...)` for `integration` files. Keep a file sequential only when scenarios intentionally depend on ordering, mutate shared setup, restart/stop services, or require another exclusive resource; make that reason obvious in the test file.
- The default test environment policy is pooled physical infrastructure and pooled stateless services so full suites can run in parallel without excessive container or port churn. Use dangerous isolation only when the test truly needs to restart or mutate a service instance in a way that would affect other tests, and include a clear reason.
- Required infrastructure such as Postgres, PgBouncer, and Valkey is resolved from service dependencies under the hood. Tests should not hand-roll containers when a harness service declaration already describes the required infrastructure.
- Optional scenario-specific infrastructure must be requested through `extraInfra`, not hand-rolled in the test. Use concrete ids such as `mailpit` for email assertions and `seaweedfs` for object-store behavior. Do not request extra infra unless the scenario actually exercises that feature path.
- Harness-backed app integration tests live in `apps/*/integration/` and run through the package's `vitest.integration.config.ts` / `test:integration` lane.
- Run integration tests with `pnpm test:integration`. This root command owns one integration runner session so pooled infrastructure and pooled services can be shared across projects.
- For `integration` subsets where pooling/timing behavior matters, still use the root runner: one package with `pnpm test:integration -- --project <pkg>`, or one file with `pnpm test:integration -- --project <pkg> <file>`.
- Detailed harness phase timing is opt-in. Use `MISTLE_TEST_TIMING=1 pnpm test:integration ...` when diagnosing setup cost; normal runs should stay concise.
- Direct package Vitest execution, such as `pnpm --filter <pkg> exec vitest run -c vitest.integration.config.ts <file>`, is only for focused local debugging. Do not use package-local direct execution as the canonical suite command or as evidence of full-suite pooling/timing behavior.
- Do not reintroduce legacy per-file fixtures, bespoke Testcontainers setup, or direct in-process app runtimes in app integration tests. App developers should select services and assert through `env`; harness internals should own service definitions, infra requirements, pooling, ports, and cleanup.
- When an integration test starts any local TCP service/runtime outside the registry, do not hard-code shared ports like `3000` or `4000`. Reserve an ephemeral port instead (for example with `reserveAvailablePort({ host: "127.0.0.1" })` from `@mistle/test-harness`) so suites can run in parallel without `EADDRINUSE`.
- Example: Testing data-plane API internal routes by selecting `services: ["data-plane-api"]` through the new harness fixture, then making HTTP requests through `env.dataPlaneApi`.

**System tests** (`*.system.test.ts`):

- Test cross-service behavior where the system, rather than one app, is the subject.
- Make HTTP requests to running services (do not import service code directly).
- Located in `tests/system/` folders.
- Use system tests for full-stack smoke, packaging, deployment-shape, and end-to-end service interaction checks that cannot be expressed as an app integration test.
- Do not put ordinary multi-service app behavior in system tests just because more than one service is involved. If one service is the subject and the other services are dependencies, prefer an integration test composed with `createIntegrationTest(...)` from `@mistle/test-harness/integration`.
- Example: Testing that a fully packaged control-plane/data-plane stack starts with the production-like entrypoints and exposes all expected health checks.

**E2E tests** (`*.e2e.test.ts`):

- Test **full user flows** through the browser using Playwright
- Located in `tests/e2e/` for cross-cutting flows, or `apps/*/e2e/` for app-specific flows
- Require the full stack to be running and accessible via public URLs
- Interact with the UI as a real user would (clicking buttons, filling forms, etc.)
- **Infrastructure:** Compose full-stack dependencies using `@mistle/test-harness` and Testcontainers (or equivalent repo-level scripts) so browser tests run against real services.
- Example: Testing the complete email OTP auth login flow from browser navigation through code verification to dashboard rendering

**When to use which:**

- Use **unit tests** for pure logic only: functions/classes/modules with no React rendering, browser DOM, provider runtime, network service, database, subprocess, or container dependency
- Use **component tests** for React components, hooks, jsdom/browser behavior, Router/QueryClient provider behavior, and rendered/static component markup that does not require external services
- Use **integration tests** when one app/service is the subject, even if the test composes additional real services as dependencies through `@mistle/test-harness`
- Use **integration tests** for side-effecting service/module behavior that requires real dependencies such as Postgres, PgBouncer, Valkey, Mailpit, SeaweedFS, workflows, subprocesses, or Mistle services. Pure unit tests are only for pure logic.
- Use **system tests** when the deployed multi-service system itself is the subject, especially packaging/deployment-shape behavior and broad smoke coverage
- Use **E2E tests** when testing user-facing flows that require browser interaction
- Use **property-based tests** for pure, input-rich logic where invariants across generated inputs provide stronger coverage than a small fixed set of examples
- If a test requires external dependencies (database, network service, subprocess/container), it is not a unit or component test and should be moved to integration or above

**Infrastructure and service composition:**

- The environment harness from `@mistle/test-harness` is mandatory for new dependency-bearing integration tests. It dedupes physical infrastructure, gives each environment isolated logical state, pools stateless services by default, and exposes service handles with reusable clients. See `packages/test-harness/src/environment/README.md` for the public API and examples.
- Prefer Testcontainers for infrastructure under the harness. App integration tests should not directly manage Testcontainers resources unless the registry does not yet model the dependency they need; if the registry is missing a dependency, add it to the registry instead of hand-rolling it in the test.
- Keep tests parallel-safe and concurrency-safe by default. Avoid fixed ports, unscoped assertions over shared mutable state, and per-test physical containers unless the test explicitly needs them.
- When adding a new service dependency, declare it once in the test registry with its exact infra requirements. Do not make individual tests remember that, for example, a service needs Postgres, PgBouncer, Valkey, or Mailpit.

### Testing Exceptions

- No exceptions by default.
- If a user explicitly directs an exception in a task, keep it minimal and temporary, add an inline justification comment with a cleanup owner and date, and avoid broad policy carve-outs.

### Snapshot Guidance

- Treat snapshots as approval artifacts, not convenience.
- Update snapshots only when changes are intentional and reviewed.
- Avoid full, noisy snapshots when targeted assertions cover the risk.
- When updating snapshots, explain the reason in the PR.

## Workflows

- Use `pnpm check:fast` as the default lightweight validation command while working. It runs full `typecheck`, non-type-aware lint, and Turbo affected `test` / `test:component`.
- The pre-push hook runs `pnpm validate:changed --base origin/main --head HEAD`. Treat that as the heavier pre-push gate, not the default validation command while iterating.
- Run `pnpm run ci` before pushing only when the change is high risk or touches shared/build/test infrastructure.
- Do not use `--no-verify` for commits or pushes; fix the underlying hook failure instead.
- Always commit using Conventional Commits (e.g. `feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`). Do not use any other format.
- Prefer small commits; break changes up into multiple commits if you need to, group related work together.

## Database Migrations

- Use the `db-migrations` skill for database migration work in this repository.

## Database Conventions

- Prefer Drizzle's relational query API (`database.query.<table>.findFirst/findMany`) over raw `database.select(...)` unless you need SQL-level control.
- In relational queries, prefer clause operator helpers from callback context (for example `where: (table, { eq, and }) => ...`) instead of importing operators directly from `drizzle-orm`.
- Runtime app and worker code must not use static Drizzle table objects from `@mistle/db/control-plane` or `@mistle/db/data-plane` in query builders. Static tables bind to the default schema and bypass request/test-environment schema isolation. Use the relational query API when possible, or resolve the bound schema with `getControlPlaneDatabaseSchema(db)` / `getDataPlaneDatabaseSchema(db)` and use `tables.<tableName>` for inserts, updates, deletes, joins, and predicates.
- Existing static-table usages are legacy debt guarded by the `mistle-db/no-static-db-tables-in-runtime` oxlint baseline. When touching nearby runtime DB code, actively migrate the touched path to bound schema tables and remove the corresponding baseline entry. Do not add new baseline entries unless the user explicitly approves a temporary exception.
- Prefer `typeid` identifiers over UUIDs for application-generated IDs.
- Prefer database-native timestamps for persisted rows: use schema defaults like `.defaultNow()` or SQL primitives like `` sql`now()` `` instead of `new Date()` values in insert/update payloads.

### Pull Requests

- GH CLI is available; you can open a PR with it when needed.
- If creating or updating a GitHub PR, use the `github-pr-authoring` skill.
- Before opening a PR, ensure your branch is rebased onto the latest `main` (for example: `git fetch origin main && git rebase origin/main`).
- If you open a PR, you must monitor its CI and address issues until the PR is green, unless the failure requires human intervention (e.g. missing GitHub secrets). Do not hack or workaround CI failures.

## Language Guidance

### TypeScript

- `any` and `as` are forbidden.
- For identifier registries and constants maps, use PascalCase object names with UPPER_SNAKE_CASE keys (for example `AppIds.CONTROL_PLANE_API`), not camelCase key access patterns.
- Check `node_modules` for external API type definitions instead of guessing.
- **NEVER use inline imports** - no `await import("./foo.js")`, no `import("pkg").Type` in type positions, no dynamic imports for types. Always use standard top-level imports. The only current exception is the `@mistle/test-harness` integration service loader documented above.
- NEVER remove or downgrade code to fix type errors from outdated dependencies; upgrade the dependency instead.
- Always ask before removing functionality or code that appears to be intentional.
- If the app is for a browser, assume we use all modern browsers unless otherwise specified, we don't need most polyfills.
- Avoid IIFEs; use module scope or named functions for one-off initialization.
- Avoid unnecessary inline closures, especially in hot paths or render loops; prefer named functions when it improves clarity or stable references. Closures are fine when they make intent clearer.
- When a module has a clear primary flow or entrypoint, prefer placing that main flow first and supporting helper functions below it.

### Rust

- Do not use `unwrap`, `expect`, `panic!`, `todo!`, `unimplemented!`, or other code paths that can panic in production Rust code. Return and handle explicit errors instead. Tests may use unwraps and panics when they make failures clearer.
- Prefer `crate::` paths over `super::`. Do not add new `super::` imports, and clean up existing `super::` usage when touching nearby code.
- Avoid `pub use` for ordinary import convenience. Use it only when intentionally shaping a public API, such as re-exporting a dependency so downstream consumers do not have to depend on it directly.
- Avoid global state through `lazy_static!`, `Once`, `OnceLock`, or similar mechanisms. Prefer passing explicit context structs for shared state.
- Prefer strong domain types over strings. Use enums and newtypes when a value has a closed set of states, requires validation, or would otherwise be easy to mix up.
