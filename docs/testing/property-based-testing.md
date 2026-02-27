# Property-Based Testing

This repository uses `fast-check` with Vitest integration for property-based tests.

## Conventions

- Name files `*.property.test.ts`.
- Keep tests colocated with the module under test.
- Assert invariants (idempotence, associativity, round-trip, canonicalization, no-mutation) instead of implementation details.

## Shared Helper

Use `@mistle/test-core`:

```ts
import { assertProperty, fc } from "@mistle/test-core";

assertProperty(
  fc.property(fc.string(), (value) => {
    // invariant assertion
  }),
);
```

Defaults from the helper:

- Local runs: `100`
- CI runs: `250`

Override run count for one property:

```ts
assertProperty(fc.property(/* ... */), { numRuns: 500 });
```

## Running Property Tests

- Run all property suites: `pnpm test:property`
- Run CI-style property budget locally: `pnpm test:property:ci`
- Run one workspace: `pnpm --filter @mistle/runtime-config test:property`

## Replay Failing Cases

When a property fails, `fast-check` reports `seed` and `path`. Replay with:

```bash
MISTLE_PROPERTY_REPLAY_SEED=<seed> \
MISTLE_PROPERTY_REPLAY_PATH='<path>' \
pnpm --filter <workspace> test:property
```

Optional global run-budget override:

```bash
MISTLE_PROPERTY_NUM_RUNS=300 pnpm test:property
```
