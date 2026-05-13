// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { IntegrationLogo } from "./integration-logo.js";

describe("IntegrationLogo", () => {
  it("renders a dark-mode source when a vendored dark logo exists", () => {
    const { container } = render(
      <IntegrationLogo alt="GitHub logo" className="size-4" logoKey="github" />,
    );

    const source = container.querySelector("source");
    expect(source?.getAttribute("media")).toBe("(prefers-color-scheme: dark)");
    expect(source?.getAttribute("srcset")).toBe("/integration-logos/github-dark.svg");

    const logo = screen.getByRole("img", { name: "GitHub logo" });
    expect(logo.getAttribute("class")).toBe("size-4");
    expect(logo.getAttribute("src")).toBe("/integration-logos/github.svg");
  });

  it("renders only the light logo when no vendored dark logo exists", () => {
    const { container } = render(<IntegrationLogo alt="Slack logo" logoKey="slack" />);

    expect(container.querySelector("source")).toBeNull();
    expect(screen.getByRole("img", { name: "Slack logo" }).getAttribute("src")).toBe(
      "/integration-logos/slack.svg",
    );
  });
});
