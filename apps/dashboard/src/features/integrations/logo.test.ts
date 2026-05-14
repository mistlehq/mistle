import { describe, expect, it } from "vitest";

import {
  hasIntegrationLogoDarkVariant,
  resolveIntegrationLogoPath,
  resolveIntegrationLogoPaths,
} from "./logo.js";

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
    expect(resolveIntegrationLogoPath({ logoKey: "sentry" })).toBe("/integration-logos/sentry.svg");
    expect(resolveIntegrationLogoPath({ logoKey: "signoz" })).toBe("/integration-logos/signoz.svg");
    expect(resolveIntegrationLogoPath({ logoKey: "opencode" })).toBe(
      "/integration-logos/opencode.svg",
    );
  });

  it("returns dark variant paths for integrations with light-sensitive marks", () => {
    expect(resolveIntegrationLogoPath({ logoKey: "github", colorScheme: "dark" })).toBe(
      "/integration-logos/github-dark.svg",
    );
    expect(resolveIntegrationLogoPath({ logoKey: "aws", colorScheme: "dark" })).toBe(
      "/integration-logos/aws-dark.svg",
    );
    expect(resolveIntegrationLogoPath({ logoKey: "slack", colorScheme: "dark" })).toBe(
      "/integration-logos/slack.svg",
    );
  });

  it("returns paired logo paths when a dark variant exists", () => {
    expect(resolveIntegrationLogoPaths({ logoKey: "openai" })).toEqual({
      light: "/integration-logos/openai.svg",
      dark: "/integration-logos/openai-dark.svg",
    });
    expect(resolveIntegrationLogoPaths({ logoKey: "linear" })).toEqual({
      light: "/integration-logos/linear.svg",
      dark: null,
    });
    expect(hasIntegrationLogoDarkVariant({ logoKey: "planetscale" })).toBe(true);
    expect(hasIntegrationLogoDarkVariant({ logoKey: "jira" })).toBe(false);
  });

  it("trims whitespace from the logo key", () => {
    expect(resolveIntegrationLogoPath({ logoKey: "  github  " })).toBe(
      "/integration-logos/github.svg",
    );
    expect(resolveIntegrationLogoPath({ logoKey: "  github  ", colorScheme: "dark" })).toBe(
      "/integration-logos/github-dark.svg",
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
