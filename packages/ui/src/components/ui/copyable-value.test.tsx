// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CopyableValue } from "./copyable-value.js";

describe("CopyableValue", () => {
  afterEach(() => {
    cleanup();
  });

  it("supports transitioning from loading to a ready value", () => {
    const { rerender } = render(<CopyableValue label="Webhook callback URL" loading />);

    expect(screen.getByText("Loading…")).toBeTruthy();

    rerender(
      <CopyableValue
        label="Webhook callback URL"
        value="https://control-plane.example.com/p/integration/callbacks/github"
      />,
    );

    expect(
      screen.getByText("https://control-plane.example.com/p/integration/callbacks/github"),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy Webhook callback URL" })).toBeTruthy();
  });
});
