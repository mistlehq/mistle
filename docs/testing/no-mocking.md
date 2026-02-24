# No Mocking, Stubbing, or Fakes in Tests

This repository uses a strict testing policy: test real behavior, not simulated behavior.

## Policy

- Do not use mocking/stubbing APIs (`vi.fn`, `vi.spyOn`, `vi.mock`, `jest.*`, `sinon`, `nock`, `msw`, and equivalents).
- Do not create manual behavioral doubles (`Fake*`, `Stub*`, `Noop*`, in-memory substitutes for external systems).
- Do not assert call history on doubles (`toHaveBeenCalled*`).
- Do not patch global time or timer behavior (`Date`, `setTimeout`, fake timers, `setSystemTime`).

## What to Assert Instead

- HTTP status/body and headers.
- Persisted database state.
- Emitted domain events / messages.
- File/object store outputs.
- UI output and navigation behavior from user interactions.

## Time-Sensitive Behavior

- Treat time as an explicit dependency.
- Use `@mistle/time` contracts and implementations (`Clock`, `Sleeper`, `Scheduler`) through app context/dependency injection.
- Use concrete deterministic implementations in tests.
- Avoid direct `Date.now()` / `new Date()` / timer calls in business logic where deterministic testing is required.

## Test Type Expectations

- Unit: pure logic only, no external dependencies.
- Integration: single app/service with real dependencies (prefer Testcontainers).
- System: multiple services interacting over HTTP.
- E2E: browser-driven full user flows.

## Property-Based Testing

Property-based tests are compatible with this policy:

- Use real code paths and real dependency boundaries.
- Keep generators deterministic (seeded where needed).
- For time/random/IDs, inject dependencies explicitly rather than patching globals.
- Follow shared PBT setup and replay guidance in `docs/testing/property-based-testing.md`.

## Exception Handling

- Exceptions are not allowed by default.
- If explicitly directed by the user for a specific task, keep scope minimal and temporary.
- Any exception must include an inline comment with:
  - justification,
  - cleanup owner,
  - cleanup date.
