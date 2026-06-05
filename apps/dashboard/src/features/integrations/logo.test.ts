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
    expect(resolveIntegrationLogoPath({ logoKey: "aws" })).toBe("/integration-logos/aws.svg");
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

  it("returns dark variant paths only for integrations that need theme-specific marks", () => {
    expect(resolveIntegrationLogoPath({ logoKey: "github", colorScheme: "dark" })).toBe(
      "/integration-logos/github-dark.svg",
    );
    expect(resolveIntegrationLogoPath({ logoKey: "planetscale", colorScheme: "dark" })).toBe(
      "/integration-logos/planetscale-dark.svg",
    );
    expect(resolveIntegrationLogoPath({ logoKey: "aws", colorScheme: "dark" })).toBe(
      "/integration-logos/aws.svg",
    );
    expect(resolveIntegrationLogoPath({ logoKey: "slack", colorScheme: "dark" })).toBe(
      "/integration-logos/slack.svg",
    );
  });

  it("returns paired logo paths for theme-specific marks", () => {
    expect(resolveIntegrationLogoPaths({ logoKey: "planetscale" })).toEqual({
      light: "/integration-logos/planetscale.svg",
      dark: "/integration-logos/planetscale-dark.svg",
    });
    expect(resolveIntegrationLogoPaths({ logoKey: "linear" })).toEqual({
      light: "/integration-logos/linear.svg",
      dark: null,
    });
    expect(resolveIntegrationLogoPaths({ logoKey: "aws" })).toEqual({
      light: "/integration-logos/aws.svg",
      dark: null,
    });
    expect(hasIntegrationLogoDarkVariant({ logoKey: "planetscale" })).toBe(true);
    expect(hasIntegrationLogoDarkVariant({ logoKey: "jira" })).toBe(false);
  });
});
