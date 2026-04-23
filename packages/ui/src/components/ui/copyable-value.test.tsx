// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CopyableValue } from "./copyable-value.js";
import { Link } from "./link.js";

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

  it("renders rich field label content while preserving copy accessibility text", () => {
    render(
      <CopyableValue
        label="Add the public key via GitHub settings or via GH CLI:"
        labelContent={
          <>
            Add the public key via{" "}
            <Link href="https://github.com/settings/keys">GitHub settings</Link> or via GH CLI:
          </>
        }
        value="gh ssh-key add ~/.ssh/id_ed25519.pub --type signing"
      />,
    );

    expect(screen.getByRole("link", { name: "GitHub settings" })).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "Copy Add the public key via GitHub settings or via GH CLI:",
      }),
    ).toBeTruthy();
  });
});
