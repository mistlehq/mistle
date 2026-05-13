import { describe, expect, it } from "vitest";

import { resolveDarkIntegrationLogoPath, resolveIntegrationLogoPath } from "./logo.js";

describe("resolveIntegrationLogoPath", () => {
  it("returns the dashboard public path for a logo key", () => {
    expect(resolveIntegrationLogoPath({ logoKey: "openai" })).toBe("/integration-logos/openai.svg");
    expect(resolveIntegrationLogoPath({ logoKey: "github" })).toBe("/integration-logos/github.svg");
    expect(resolveIntegrationLogoPath({ logoKey: "jira" })).toBe("/integration-logos/jira.svg");
    expect(resolveIntegrationLogoPath({ logoKey: "google" })).toBe("/integration-logos/google.svg");
    expect(resolveIntegrationLogoPath({ logoKey: "linear" })).toBe("/integration-logos/linear.svg");
    expect(resolveIntegrationLogoPath({ logoKey: "slack" })).toBe("/integration-logos/slack.svg");
    expect(resolveIntegrationLogoPath({ logoKey: "aws" })).toBe("/integration-logos/aws.svg");
    expect(resolveIntegrationLogoPath({ logoKey: "anthropic" })).toBe(
      "/integration-logos/anthropic.svg",
    );
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

describe("resolveDarkIntegrationLogoPath", () => {
  it("returns the dashboard public dark variant path for logo keys with vendored dark assets", () => {
    expect(resolveDarkIntegrationLogoPath({ logoKey: "anthropic" })).toBe(
      "/integration-logos/anthropic-dark.svg",
    );
    expect(resolveDarkIntegrationLogoPath({ logoKey: "e2b" })).toBe(
      "/integration-logos/e2b-dark.svg",
    );
    expect(resolveDarkIntegrationLogoPath({ logoKey: "github" })).toBe(
      "/integration-logos/github-dark.svg",
    );
    expect(resolveDarkIntegrationLogoPath({ logoKey: "openai" })).toBe(
      "/integration-logos/openai-dark.svg",
    );
    expect(resolveDarkIntegrationLogoPath({ logoKey: "opencode" })).toBe(
      "/integration-logos/opencode-dark.svg",
    );
    expect(resolveDarkIntegrationLogoPath({ logoKey: "planetscale" })).toBe(
      "/integration-logos/planetscale-dark.svg",
    );
  });

  it("returns no dark variant path for logo keys whose single asset works across themes", () => {
    expect(resolveDarkIntegrationLogoPath({ logoKey: "aws" })).toBeUndefined();
    expect(resolveDarkIntegrationLogoPath({ logoKey: "jira" })).toBeUndefined();
    expect(resolveDarkIntegrationLogoPath({ logoKey: "signoz" })).toBeUndefined();
    expect(resolveDarkIntegrationLogoPath({ logoKey: "slack" })).toBeUndefined();
    expect(resolveDarkIntegrationLogoPath({ logoKey: "linear" })).toBeUndefined();
    expect(resolveDarkIntegrationLogoPath({ logoKey: "datadog" })).toBeUndefined();
  });

  it("trims whitespace and throws for empty logo keys", () => {
    expect(resolveDarkIntegrationLogoPath({ logoKey: "  github  " })).toBe(
      "/integration-logos/github-dark.svg",
    );
    expect(() => resolveDarkIntegrationLogoPath({ logoKey: "" })).toThrow(
      "Integration logo key must be a non-empty string.",
    );
  });
});
