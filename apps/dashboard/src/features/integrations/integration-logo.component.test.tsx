// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { IntegrationLogo } from "./integration-logo.js";

describe("IntegrationLogo", () => {
  it("renders light and dark dashboard logos when a dark logo asset exists", () => {
    const { container } = render(
      <IntegrationLogo alt="GitHub logo" className="size-4" logoKey="github" />,
    );

    expect(container.querySelector("source")).toBeNull();
    expect(container.querySelector("picture")).toBeNull();

    const logo = screen.getByRole("img", { name: "GitHub logo" });
    expect(logo.tagName).toBe("SPAN");

    const images = container.querySelectorAll("img");
    expect(images).toHaveLength(2);
    expect(images[0]?.getAttribute("class")).toBe("size-4 dark:hidden");
    expect(images[0]?.getAttribute("src")).toBe("/integration-logos/github.svg");
    expect(images[1]?.getAttribute("class")).toBe("size-4 hidden dark:inline-block");
    expect(images[1]?.getAttribute("src")).toBe("/integration-logos/github-dark.svg");
  });

  it("renders the light dashboard logo for single-asset integrations", () => {
    const { container } = render(<IntegrationLogo alt="Slack logo" logoKey="slack" />);

    expect(container.querySelector("source")).toBeNull();
    expect(container.querySelector("picture")).toBeNull();
    expect(screen.getByRole("img", { name: "Slack logo" }).getAttribute("src")).toBe(
      "/integration-logos/slack.svg",
    );
  });

  it("keeps decorative variant logos hidden from the accessibility tree", () => {
    const { container } = render(<IntegrationLogo alt="" logoKey="openai" />);

    expect(container.querySelector('[role="img"]')).toBeNull();
    expect(container.querySelector("span")?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelectorAll("img")).toHaveLength(2);
  });
});
