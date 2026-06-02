// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { TextLink } from "./link.js";

describe("TextLink", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders a regular inline link without a new-window affordance", () => {
    const { container } = render(<TextLink href="/sessions/example">Session title</TextLink>);

    const link = screen.getByRole("link", { name: "Session title" });
    expect(link.getAttribute("href")).toBe("/sessions/example");
    expect(link.className).toContain("cursor-default");
    expect(link.hasAttribute("target")).toBe(false);
    expect(link.hasAttribute("rel")).toBe(false);
    expect(container.querySelector('[data-icon="inline-end"]')).toBeNull();
  });

  it("adds new-window attributes and the outward icon when requested", () => {
    const { container } = render(
      <TextLink href="https://github.com/settings/keys" opensInNewWindow>
        GitHub settings
      </TextLink>,
    );

    const link = screen.getByRole("link", { name: "GitHub settings" });
    expect(link.getAttribute("href")).toBe("https://github.com/settings/keys");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer");
    expect(container.querySelector('[data-icon="inline-end"]')).not.toBeNull();
  });
});
