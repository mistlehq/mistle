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

## Runtime Usage

```ts
import { type Clock, systemClock } from "@mistle/time";

export function createTokenExpiry(clock: Clock = systemClock): number {
  const oneHourMs = 60 * 60 * 1000;
  return clock.nowMs() + oneHourMs;
}
```

## Testing Usage

```ts
import { type Clock } from "@mistle/time";

const fixedClock: Clock = {
  nowMs: () => 1_700_000_000_000,
  nowDate: () => new Date(1_700_000_000_000),
};
```

The second example shows the preferred test pattern: pass a deterministic implementation directly rather than mocking global timers or dates.

## Enforcement

Repository lint rules enforce this convention by flagging direct time/timer usage in application code.
