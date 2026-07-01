import { describe, expect, it } from "vitest";

import {
  DesignerIntegrationCatalogFileId,
  DesignerIntegrationCatalogRuntimePath,
} from "../runtime-references/designer-integration-catalog.js";
import {
  createDesignerIntegrationCatalogSetupFile,
  createDesignerRuntimeReferenceSetupFiles,
} from "./designer-runtime-reference-files.js";

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

  it("creates a Codex setup file for the AI software factory workflow reference", () => {
    const setupFiles = createDesignerRuntimeReferenceSetupFiles();
    const setupFile = setupFiles.find(
      (file) =>
        file.path === "/root/.mistle/designer/references/workflow-patterns/ai-software-factory.md",
    );

    expect(setupFile).toMatchObject({
      fileId: "designer_ai_software_factory_reference",
      mode: 420,
      writeMode: "overwrite",
    });
    expect(setupFile?.content).toContain("# AI Software Factory Workflow Pattern");
    expect(setupFile?.content).toContain("implementation and review");
    expect(setupFile?.content).toContain("Linear MCP provider tool");
  });
});
