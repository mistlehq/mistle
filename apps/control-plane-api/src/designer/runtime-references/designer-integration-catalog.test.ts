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
    expect(markdown).toContain("- `linear.issue.created`: Issue created");
  });
});
