// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { IntegrationLogo } from "./integration-logo.js";

describe("IntegrationLogo", () => {
  it("renders the light dashboard logo asset directly", () => {
    const { container } = render(<IntegrationLogo alt="Slack logo" logoKey="slack" />);

    expect(container.querySelector("source")).toBeNull();
    expect(container.querySelector("picture")).toBeNull();
    expect(screen.getByRole("img", { name: "Slack logo" }).getAttribute("src")).toBe(
      "/integration-logos/slack.svg",
    );
  });

  it("renders paired light and dark dashboard logos when a dark asset exists", () => {
    const { container } = render(
      <IntegrationLogo alt="PlanetScale logo" className="size-4" logoKey="planetscale" />,
    );

    expect(container.querySelector("source")).toBeNull();
    expect(container.querySelector("picture")).toBeNull();

    const logo = screen.getByRole("img", { name: "PlanetScale logo" });
    expect(logo.tagName).toBe("SPAN");
    expect(logo.getAttribute("class")).toContain("size-4");
    expect(logo.getAttribute("class")).toContain("shrink-0");

    const images = container.querySelectorAll("img");
    expect(images).toHaveLength(2);
    expect(images[0]?.classList).toContain("object-contain");
    expect(images[0]?.classList).toContain("dark:hidden");
    expect(images[0]?.classList).toContain("size-full");
    expect(images[0]?.getAttribute("src")).toBe("/integration-logos/planetscale.svg");
    expect(images[1]?.classList).toContain("hidden");
    expect(images[1]?.classList).toContain("object-contain");
    expect(images[1]?.classList).toContain("dark:inline-block");
    expect(images[1]?.classList).toContain("size-full");
    expect(images[1]?.getAttribute("src")).toBe("/integration-logos/planetscale-dark.svg");
  });

  it("preserves caller visual classes on the paired logo frame", () => {
    const { container } = render(
      <IntegrationLogo alt="GitHub logo" className="size-4 rounded-sm" logoKey="github" />,
    );

    const logo = screen.getByRole("img", { name: "GitHub logo" });
    expect(logo.getAttribute("class")).toContain("size-4");
    expect(logo.getAttribute("class")).toContain("rounded-sm");

    const images = container.querySelectorAll("img");
    expect(images).toHaveLength(2);
    expect(images[0]?.getAttribute("class")).not.toContain("rounded-sm");
    expect(images[1]?.getAttribute("class")).not.toContain("rounded-sm");
  });

  it("renders the square AWS logo as a single dashboard asset", () => {
    const { container } = render(<IntegrationLogo alt="AWS logo" logoKey="aws" />);

    const images = container.querySelectorAll("img");
    expect(images).toHaveLength(1);
    expect(screen.getByRole("img", { name: "AWS logo" }).getAttribute("src")).toBe(
      "/integration-logos/aws.svg",
    );
  });

  it("keeps decorative logos hidden from the accessibility tree", () => {
    const { container } = render(<IntegrationLogo alt="" logoKey="openai" />);

    expect(container.querySelector('[role="img"]')).toBeNull();
    expect(container.querySelector("span")?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelectorAll("img")).toHaveLength(2);
  });
});
