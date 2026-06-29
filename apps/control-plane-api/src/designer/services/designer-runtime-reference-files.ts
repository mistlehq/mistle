import { readFileSync } from "node:fs";

import type { RuntimeClientSetupFile } from "@mistle/integrations-core";

import {
  DesignerIntegrationCatalogFileId,
  DesignerIntegrationCatalogRuntimePath,
} from "../runtime-references/designer-integration-catalog.js";

const DesignerRuntimeReferenceFileNames = {
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
