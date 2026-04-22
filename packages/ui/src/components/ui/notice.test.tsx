// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
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
});
