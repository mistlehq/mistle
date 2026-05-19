// @vitest-environment jsdom

import { createManualScheduler, createMutableClock } from "@mistle/time/testing";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useDelayedMinimumVisibleFlag } from "./use-delayed-minimum-visible-flag.js";

describe("useDelayedMinimumVisibleFlag", () => {
  it("does not become visible when the active state clears before the show delay", () => {
    const clock = createMutableClock();
    const scheduler = createManualScheduler(clock);
    const { result, rerender } = renderHook(
      ({ active }) =>
        useDelayedMinimumVisibleFlag({
          active,
          clock,
          minimumVisibleMs: 300,
          scheduler,
          showDelayMs: 100,
        }),
      {
        initialProps: {
          active: true,
        },
      },
    );

    expect(result.current).toBe(false);

    rerender({ active: false });
    act(() => {
      clock.advanceMs(100);
      scheduler.runDue();
    });

    expect(result.current).toBe(false);
  });

  it("stays visible for the minimum duration after the active state clears", () => {
    const clock = createMutableClock();
    const scheduler = createManualScheduler(clock);
    const { result, rerender } = renderHook(
      ({ active }) =>
        useDelayedMinimumVisibleFlag({
          active,
          clock,
          minimumVisibleMs: 300,
          scheduler,
          showDelayMs: 100,
        }),
      {
        initialProps: {
          active: true,
        },
      },
    );

    act(() => {
      clock.advanceMs(100);
      scheduler.runDue();
    });

    expect(result.current).toBe(true);

    rerender({ active: false });
    act(() => {
      clock.advanceMs(299);
      scheduler.runDue();
    });

    expect(result.current).toBe(true);

    act(() => {
      clock.advanceMs(1);
      scheduler.runDue();
    });

    expect(result.current).toBe(false);
  });
});
