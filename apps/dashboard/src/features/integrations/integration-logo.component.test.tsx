// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { IntegrationLogo } from "./integration-logo.js";

describe("IntegrationLogo", () => {
  it("renders the light dashboard logo even when a dark logo asset exists", () => {
    const { container } = render(
      <IntegrationLogo alt="GitHub logo" className="size-4" logoKey="github" />,
    );

    expect(container.querySelector("source")).toBeNull();
    expect(container.querySelector("picture")).toBeNull();

    const logo = screen.getByRole("img", { name: "GitHub logo" });
    expect(logo.getAttribute("class")).toBe("size-4");
    expect(logo.getAttribute("src")).toBe("/integration-logos/github.svg");
  });

  it("renders the light dashboard logo for single-asset integrations", () => {
    const { container } = render(<IntegrationLogo alt="Slack logo" logoKey="slack" />);

    expect(container.querySelector("source")).toBeNull();
    expect(container.querySelector("picture")).toBeNull();
    expect(screen.getByRole("img", { name: "Slack logo" }).getAttribute("src")).toBe(
      "/integration-logos/slack.svg",
    );
  });
});
