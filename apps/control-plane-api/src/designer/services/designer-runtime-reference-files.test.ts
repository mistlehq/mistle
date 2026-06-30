import { describe, expect, it } from "vitest";

import {
  DesignerIntegrationCatalogFileId,
  DesignerIntegrationCatalogRuntimePath,
} from "../runtime-references/designer-integration-catalog.js";
import { createDesignerIntegrationCatalogSetupFile } from "./designer-runtime-reference-files.js";

describe("Designer runtime reference files", () => {
  it("creates a Codex setup file for the generated integration catalog", () => {
    const setupFile = createDesignerIntegrationCatalogSetupFile();

    expect(setupFile).toMatchObject({
      fileId: DesignerIntegrationCatalogFileId,
      path: DesignerIntegrationCatalogRuntimePath,
      mode: 420,
      writeMode: "overwrite",
    });
    expect(setupFile.content).toContain("# Designer Integration Catalog");
    expect(setupFile.content).toContain("Integration target key: `linear-default`");
    expect(setupFile.content).toContain("- `linear-mcp`: Linear MCP");
  });
});
