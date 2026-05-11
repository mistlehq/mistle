import { describe, expect, it } from "vitest";

import { resolveIntegrationLogoPath } from "./logo.js";

describe("resolveIntegrationLogoPath", () => {
  it("returns the dashboard public path for a logo key", () => {
    expect(resolveIntegrationLogoPath({ logoKey: "openai" })).toBe("/integration-logos/openai.svg");
    expect(resolveIntegrationLogoPath({ logoKey: "github" })).toBe("/integration-logos/github.svg");
    expect(resolveIntegrationLogoPath({ logoKey: "jira" })).toBe("/integration-logos/jira.svg");
    expect(resolveIntegrationLogoPath({ logoKey: "google" })).toBe("/integration-logos/google.svg");
    expect(resolveIntegrationLogoPath({ logoKey: "linear" })).toBe("/integration-logos/linear.svg");
    expect(resolveIntegrationLogoPath({ logoKey: "slack" })).toBe("/integration-logos/slack.svg");
    expect(resolveIntegrationLogoPath({ logoKey: "aws" })).toBe("/integration-logos/aws.svg");
    expect(resolveIntegrationLogoPath({ logoKey: "datadog" })).toBe(
      "/integration-logos/datadog.svg",
    );
    expect(resolveIntegrationLogoPath({ logoKey: "e2b" })).toBe("/integration-logos/e2b.svg");
    expect(resolveIntegrationLogoPath({ logoKey: "planetscale" })).toBe(
      "/integration-logos/planetscale.svg",
    );
    expect(resolveIntegrationLogoPath({ logoKey: "signoz" })).toBe("/integration-logos/signoz.svg");
    expect(resolveIntegrationLogoPath({ logoKey: "opencode" })).toBe(
      "/integration-logos/opencode.svg",
    );
  });

  it("trims whitespace from the logo key", () => {
    expect(resolveIntegrationLogoPath({ logoKey: "  github  " })).toBe(
      "/integration-logos/github.svg",
    );
  });

  it("throws for empty logo keys", () => {
    expect(() => resolveIntegrationLogoPath({ logoKey: "" })).toThrow(
      "Integration logo key must be a non-empty string.",
    );
    expect(() => resolveIntegrationLogoPath({ logoKey: "   " })).toThrow(
      "Integration logo key must be a non-empty string.",
    );
  });
});
