// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CopyableValue } from "./copyable-value.js";
import { TextLink } from "./link.js";

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

  it("keeps field values on one row with horizontal overflow", () => {
    render(
      <CopyableValue
        label="Webhook callback URL"
        value="https://control-plane.example.com/p/integration/webhooks/github-cloud/ep_demo_long_token"
      />,
    );

    expect(screen.getByText(/github-cloud/).className).toContain("whitespace-nowrap");
    expect(screen.getByText(/github-cloud/).className).toContain("overflow-x-auto");
    expect(screen.getByText(/github-cloud/).className).toContain("thin-scrollbar-x");
    expect(screen.getByText(/github-cloud/).className).toContain("min-h-12");
    expect(screen.getByText(/github-cloud/).className).toContain("items-start");
    expect(screen.getByText(/github-cloud/).className).toContain("pt-3");
    expect(screen.getByText(/github-cloud/).className).toContain("text-sm");
    expect(screen.getByText(/github-cloud/).className).toContain("leading-6");
  });

  it("renders rich field label content while preserving copy accessibility text", () => {
    render(
      <CopyableValue
        label="Add the public key via GitHub settings or via GH CLI:"
        labelContent={
          <>
            Add the public key via{" "}
            <TextLink href="https://github.com/settings/keys">GitHub settings</TextLink> or via GH
            CLI:
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
