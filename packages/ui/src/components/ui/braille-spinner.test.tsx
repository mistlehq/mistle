// @vitest-environment jsdom

import { createManualScheduler, createMutableClock } from "@mistle/time/testing";
import { cleanup, render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { BrailleSpinner } from "./braille-spinner.js";

function renderTestSpinner() {
  const clock = createMutableClock(0);
  const scheduler = createManualScheduler(clock);

  render(
    <BrailleSpinner aria-hidden={false} aria-label="Starting session" scheduler={scheduler} />,
  );

  return { clock, scheduler };
}

describe("BrailleSpinner", () => {
  afterEach(() => {
    cleanup();
  });

  it("advances through braille frames on the provided scheduler", () => {
    const { clock, scheduler } = renderTestSpinner();

    expect(screen.getByLabelText("Starting session").textContent).toBe("⠋");

    clock.advanceMs(79);
    expect(scheduler.runDue()).toBe(0);
    expect(screen.getByLabelText("Starting session").textContent).toBe("⠋");

    clock.advanceMs(1);
    act(() => {
      expect(scheduler.runDue()).toBe(1);
    });
    expect(screen.getByLabelText("Starting session").textContent).toBe("⠙");
  });

  it("wraps back to the first braille frame", () => {
    const { clock, scheduler } = renderTestSpinner();

    for (let frameIndex = 0; frameIndex < 10; frameIndex += 1) {
      clock.advanceMs(80);
      act(() => {
        expect(scheduler.runDue()).toBe(1);
      });
    }

    expect(screen.getByLabelText("Starting session").textContent).toBe("⠋");
  });

  it("cancels the pending frame advance when unmounted", () => {
    const clock = createMutableClock(0);
    const scheduler = createManualScheduler(clock);
    const rendered = render(<BrailleSpinner scheduler={scheduler} />);

    expect(scheduler.pendingCount()).toBe(1);

    rendered.unmount();

    expect(scheduler.pendingCount()).toBe(0);
  });
});
