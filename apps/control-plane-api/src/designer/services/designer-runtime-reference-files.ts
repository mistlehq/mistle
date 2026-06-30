import { readFileSync } from "node:fs";

import type { RuntimeClientSetupFile } from "@mistle/integrations-core";

import {
  DesignerIntegrationCatalogFileId,
  DesignerIntegrationCatalogRuntimePath,
} from "../runtime-references/designer-integration-catalog.js";

const DesignerRuntimeReferenceFileNames = {
  AI_SOFTWARE_FACTORY: "ai-software-factory.md",
  INTEGRATION_CATALOG: "integration-catalog.md",
};

type DesignerRuntimeReferenceFileName =
  (typeof DesignerRuntimeReferenceFileNames)[keyof typeof DesignerRuntimeReferenceFileNames];

export function loadDesignerRuntimeReferenceContent(
  fileName: DesignerRuntimeReferenceFileName,
): string {
  const content = readFileSync(
    new URL(`../runtime-references/${fileName}`, import.meta.url),
    "utf8",
  ).trim();
  if (content.length === 0) {
    throw new Error(`Designer runtime reference file '${fileName}' must not be empty.`);
  }

  return content;
}

export function createDesignerIntegrationCatalogSetupFile(): RuntimeClientSetupFile {
  return {
    fileId: DesignerIntegrationCatalogFileId,
    path: DesignerIntegrationCatalogRuntimePath,
    mode: 420,
    writeMode: "overwrite",
    content: `${loadDesignerRuntimeReferenceContent(
      DesignerRuntimeReferenceFileNames.INTEGRATION_CATALOG,
    )}\n`,
  };
}

export function createDesignerAiSoftwareFactoryReferenceSetupFile(): RuntimeClientSetupFile {
  return {
    fileId: "designer_ai_software_factory_reference",
    path: "/root/.mistle/designer/references/workflow-patterns/ai-software-factory.md",
    mode: 420,
    writeMode: "overwrite",
    content: `${loadDesignerRuntimeReferenceContent(
      DesignerRuntimeReferenceFileNames.AI_SOFTWARE_FACTORY,
    )}\n`,
  };
}

export function createDesignerRuntimeReferenceSetupFiles(): readonly RuntimeClientSetupFile[] {
  return [
    createDesignerIntegrationCatalogSetupFile(),
    createDesignerAiSoftwareFactoryReferenceSetupFile(),
  ];
}
