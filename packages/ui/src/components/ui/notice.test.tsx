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
});
