import { createIntegrationRegistry } from "@mistle/integrations-definitions/server";
import { describe, expect, it } from "vitest";

import {
  assertDesignerIntegrationCatalogWithinBudget,
  renderDesignerIntegrationCatalogMarkdown,
} from "./designer-integration-catalog.js";

describe("Designer integration catalog", () => {
  it("renders compact static metadata for Linear lookup", () => {
    const markdown = renderDesignerIntegrationCatalogMarkdown(
      createIntegrationRegistry().listDefinitions(),
    );

    assertDesignerIntegrationCatalogWithinBudget(markdown);
    expect(markdown).toContain("<!-- Generated from the Mistle integration registry.");
    expect(markdown).toContain("## Linear");
    expect(markdown).toContain("Provider family ID: `linear`");
    expect(markdown).toContain("Integration target key: `linear-default`");
    expect(markdown).toContain("- `linear-oauth-app` (form): Linear OAuth app");
    expect(markdown).toContain("Binding tools:");
    expect(markdown).toContain("- `linear-mcp`: Linear MCP");
    expect(markdown).toContain("- `linear.issue.created`: Issue created");
  });

  it("renders binding tool defaults for GitHub sandbox capability selection", () => {
    const markdown = renderDesignerIntegrationCatalogMarkdown(
      createIntegrationRegistry().listDefinitions(),
    );

    assertDesignerIntegrationCatalogWithinBudget(markdown);
    expect(markdown).toContain("## GitHub");
    expect(markdown).toContain("Integration target key: `github-cloud`");
    expect(markdown).toContain("- `github-cli`: GitHub CLI (default)");
  });

  it("omits optional catalog sections when the integration has no values", () => {
    const markdown = renderDesignerIntegrationCatalogMarkdown(
      createIntegrationRegistry().listDefinitions(),
    );

    const anthropicSection = readCatalogSection(markdown, "Anthropic");

    expect(anthropicSection).toContain("Setup methods:");
    expect(anthropicSection).not.toContain("Resource kinds:");
    expect(anthropicSection).not.toContain("Binding tools:");
    expect(anthropicSection).not.toContain("Trigger events:");
    expect(anthropicSection).not.toContain("- None");
  });
});

function readCatalogSection(markdown: string, displayName: string): string {
  const sectionHeading = `## ${displayName}`;
  const sectionStart = markdown.indexOf(sectionHeading);
  if (sectionStart === -1) {
    throw new Error(`Catalog section '${displayName}' was not rendered.`);
  }

  const nextSectionStart = markdown.indexOf("\n## ", sectionStart + sectionHeading.length);
  if (nextSectionStart === -1) {
    return markdown.slice(sectionStart);
  }

  return markdown.slice(sectionStart, nextSectionStart);
}
