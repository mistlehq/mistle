# @mistle/time

Shared time primitives for Mistle.

Use this package as the canonical source for time-related behavior (wall clock, sleeping, scheduling, and epoch/date helpers) instead of calling `Date.now`, `new Date`, `setTimeout`, or `clearTimeout` directly in app logic.

This keeps time access explicit and injectable so tests can use deterministic implementations via dependency injection, without relying on mocks/stubs of globals.

## Public API

Exported from [`src/index.ts`](./src/index.ts):

- `Clock` and `systemClock`
  - `nowMs(): number`
  - `nowDate(): Date`
- `Sleeper` and `systemSleeper`
  - `sleep(durationMs: number): Promise<void>`
- `Scheduler`, `TimerHandle`, and `systemScheduler`
  - `schedule(callback, delayMs): TimerHandle`
  - `cancel(handle): void`
- Epoch/date helpers
  - `toEpochSeconds(date: Date): number`
  - `dateFromEpochMs(epochMs: number): Date`
  - `dateFromEpochSeconds(epochSeconds: number): Date`
  - `toIsoFromEpochSeconds(epochSeconds: number): string`
  - `addMilliseconds(date: Date, durationMs: number): Date`

Exported from `@mistle/time/testing` ([`src/testing/index.ts`](./src/testing/index.ts)):

- `createFixedClock(fixedNowMs)`
- `createMutableClock(initialNowMs?)`
- `createManualScheduler(clock)`
- `immediateSleeper`

## Dependency Injection Pattern

Define app logic against time interfaces, then inject concrete implementations at composition time.

```ts
import type { Clock, Scheduler } from "@mistle/time";

type ReminderServiceDeps = {
  clock: Clock;
  scheduler: Scheduler;
};

export function createReminderService(deps: ReminderServiceDeps) {
  return {
    scheduleReminder(delayMs: number, onDue: () => void) {
      const dueAtMs = deps.clock.nowMs() + delayMs;
      deps.scheduler.schedule(() => {
        if (deps.clock.nowMs() >= dueAtMs) {
          onDue();
        }
      }, delayMs);
    },
  };
}
```

## Runtime Composition

```ts
import { systemClock, systemScheduler } from "@mistle/time";

const reminderService = createReminderService({
  clock: systemClock,
  scheduler: systemScheduler,
});
```

## Testing Composition

```ts
import { createManualScheduler, createMutableClock } from "@mistle/time/testing";

const clock = createMutableClock(1_700_000_000_000);
const scheduler = createManualScheduler(clock);
const reminderService = createReminderService({ clock, scheduler });

let called = false;
reminderService.scheduleReminder(5_000, () => {
  called = true;
});

clock.advanceMs(5_000);
scheduler.runDue();
// called === true
```

Use `@mistle/time/testing` helpers to keep time deterministic in tests without mocking global date/timer APIs.

## Enforcement

Repository lint rules enforce this convention by flagging direct time/timer usage in application code.
