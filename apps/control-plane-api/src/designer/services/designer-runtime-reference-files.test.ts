import { describe, expect, it } from "vitest";

import {
  DesignerIntegrationCatalogFileId,
  DesignerIntegrationCatalogRuntimePath,
} from "../runtime-references/designer-integration-catalog.js";
import {
  createDesignerIntegrationCatalogSetupFile,
  createDesignerRuntimeReferenceSetupFiles,
  loadDesignerRuntimeReferenceContent,
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
    expect(setupFile?.content).toContain("# AI Software Factory Workflow Reference");
    expect(setupFile?.content).toContain("Linear MCP provider tool");
    expect(setupFile?.content).toContain("## Completion Criteria");
    expect(setupFile?.content).toContain("## Example Outputs");
  });

  it("keeps workflow references focused on domain knowledge instead of session choreography", () => {
    const referenceContent = loadDesignerRuntimeReferenceContent("ai-software-factory.md");

    expect(referenceContent).toContain("Review feedback must loop back into implementation");
    expect(referenceContent).toContain("## Completion Criteria");
    expect(referenceContent).not.toContain("conditionLabel");
    expect(referenceContent).not.toContain("routeTo");
    expect(referenceContent).not.toContain("routing item");
    expect(referenceContent).not.toContain("trigger node");
    expect(referenceContent).not.toContain("First propose");
    expect(referenceContent).not.toContain("Use these exact");
    expect(referenceContent).not.toContain("End with one clear");
  });
});
