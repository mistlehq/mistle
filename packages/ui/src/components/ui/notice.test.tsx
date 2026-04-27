// @vitest-environment jsdom

import { createManualScheduler, createMutableClock } from "@mistle/time/testing";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { Notice } from "./notice.js";

describe("Notice", () => {
  afterEach(() => {
    cleanup();
  });

  it("defaults destructive notices to alert semantics", () => {
    render(<Notice variant="alert">Request failed.</Notice>);

    const notice = screen.getByRole("alert");

    expect(notice.getAttribute("aria-live")).toBe("assertive");
    expect(notice.textContent).toContain("Request failed.");
  });

  it("preserves explicit urgency semantics when provided", () => {
    render(
      <Notice aria-live="polite" role="status" variant="alert">
        Request failed.
      </Notice>,
    );

    const notice = screen.getByRole("status");

    expect(notice.getAttribute("aria-live")).toBe("polite");
  });

  it("does not assign alert semantics to warning notices by default", () => {
    render(<Notice variant="warning">Check this state before continuing.</Notice>);

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Check this state before continuing.")).toBeTruthy();
  });

  it("does not assign alert semantics to success notices by default", () => {
    render(<Notice variant="success">GitHub linked successfully.</Notice>);

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("GitHub linked successfully.")).toBeTruthy();
  });

  it("renders structured descriptions without a title", () => {
    render(
      <Notice icon={<span aria-hidden="true">i</span>} variant="success">
        GitHub linked successfully.
      </Notice>,
    );

    expect(screen.getByText("GitHub linked successfully.")).toBeTruthy();
  });

  it("does not render a dismiss button by default", () => {
    render(<Notice variant="success">GitHub linked successfully.</Notice>);

    expect(screen.queryByRole("button", { name: "Dismiss notice" })).toBeNull();
    expect(screen.getByText("GitHub linked successfully.")).toBeTruthy();
  });

  it("hides the notice when the dismiss button is pressed", () => {
    render(
      <Notice dismissible variant="success">
        GitHub linked successfully.
      </Notice>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Dismiss notice" }));

    expect(screen.queryByText("GitHub linked successfully.")).toBeNull();
  });

  it("hides the notice after the configured duration", () => {
    const clock = createMutableClock(0);
    const scheduler = createManualScheduler(clock);

    render(
      <Notice autoHideAfterMs={1_000} scheduler={scheduler} variant="success">
        GitHub linked successfully.
      </Notice>,
    );

    expect(screen.getByText("GitHub linked successfully.")).toBeTruthy();

    clock.advanceMs(999);
    expect(scheduler.runDue()).toBe(0);
    expect(screen.getByText("GitHub linked successfully.")).toBeTruthy();

    clock.advanceMs(1);
    act(() => {
      expect(scheduler.runDue()).toBe(1);
    });

    expect(screen.queryByText("GitHub linked successfully.")).toBeNull();
  });

  it("does not dismiss twice when manual dismissal happens before auto-hide", () => {
    const clock = createMutableClock(0);
    const scheduler = createManualScheduler(clock);
    const dismissEvents: string[] = [];

    render(
      <Notice
        autoHideAfterMs={1_000}
        dismissible
        onDismiss={() => dismissEvents.push("dismissed")}
        scheduler={scheduler}
        variant="success"
      >
        GitHub linked successfully.
      </Notice>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Dismiss notice" }));

    expect(screen.queryByText("GitHub linked successfully.")).toBeNull();
    expect(dismissEvents).toEqual(["dismissed"]);

    clock.advanceMs(1_000);
    act(() => {
      expect(scheduler.runDue()).toBe(0);
    });

    expect(dismissEvents).toEqual(["dismissed"]);
  });

  it("shows a later notice when the same component instance receives new content", () => {
    const { rerender } = render(
      <Notice dismissible resetKey="saved" title="Saved" variant="success">
        GitHub linked successfully.
      </Notice>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Dismiss notice" }));

    expect(screen.queryByText("GitHub linked successfully.")).toBeNull();

    rerender(
      <Notice dismissible resetKey="request-failed" title="Request failed" variant="alert">
        Please try again later.
      </Notice>,
    );

    expect(screen.getByText("Request failed")).toBeTruthy();
    expect(screen.getByText("Please try again later.")).toBeTruthy();
  });

  it("keeps a JSX notice dismissed across ordinary rerenders with the same reset key", () => {
    const { rerender } = render(
      <Notice dismissible resetKey="saved" title={<span>Saved</span>} variant="success">
        <span>GitHub linked successfully.</span>
      </Notice>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Dismiss notice" }));

    expect(screen.queryByText("GitHub linked successfully.")).toBeNull();

    rerender(
      <Notice dismissible resetKey="saved" title={<span>Saved</span>} variant="success">
        <span>GitHub linked successfully.</span>
      </Notice>,
    );

    expect(screen.queryByText("GitHub linked successfully.")).toBeNull();
  });

  it("restarts the auto-hide timer when the reset key changes", () => {
    const clock = createMutableClock(0);
    const scheduler = createManualScheduler(clock);
    const { rerender } = render(
      <Notice
        autoHideAfterMs={5_000}
        resetKey="first-message"
        scheduler={scheduler}
        variant="success"
      >
        First message.
      </Notice>,
    );

    clock.advanceMs(4_000);
    rerender(
      <Notice
        autoHideAfterMs={5_000}
        resetKey="second-message"
        scheduler={scheduler}
        variant="success"
      >
        Second message.
      </Notice>,
    );

    expect(screen.queryByText("First message.")).toBeNull();
    expect(screen.getByText("Second message.")).toBeTruthy();

    clock.advanceMs(1_000);
    act(() => {
      expect(scheduler.runDue()).toBe(0);
    });
    expect(screen.getByText("Second message.")).toBeTruthy();

    clock.advanceMs(4_000);
    act(() => {
      expect(scheduler.runDue()).toBe(1);
    });

    expect(screen.queryByText("Second message.")).toBeNull();
  });
});
