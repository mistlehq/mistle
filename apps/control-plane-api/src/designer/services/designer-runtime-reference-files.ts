import { readdirSync, readFileSync } from "node:fs";
import { basename, extname } from "node:path";

import type { RuntimeClientSetupFile } from "@mistle/integrations-core";

import { DesignerIntegrationCatalogRuntimeDirectoryPath } from "../runtime-references/designer-integration-catalog.js";

const DesignerRuntimeReferenceFileNames = {
  AI_SOFTWARE_FACTORY: "ai-software-factory.md",
  REFERENCE_MAP: "reference-map.md",
};

const DesignerRuntimeReferenceDirectoryNames = {
  INTEGRATIONS: "integrations",
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
  const setupFiles = createDesignerIntegrationCatalogSetupFiles();
  const indexSetupFile = setupFiles.find((file) => file.path.endsWith("/index.md"));
  if (indexSetupFile === undefined) {
    throw new Error("Designer integration catalog index setup file was not created.");
  }

  return indexSetupFile;
}

export function createDesignerIntegrationCatalogSetupFiles(): readonly RuntimeClientSetupFile[] {
  return loadDesignerRuntimeReferenceDirectoryFiles(
    DesignerRuntimeReferenceDirectoryNames.INTEGRATIONS,
  ).map((file) => ({
    fileId: `designer_integration_catalog_${basename(
      file.fileName,
      extname(file.fileName),
    ).replaceAll("-", "_")}`,
    path: `${DesignerIntegrationCatalogRuntimeDirectoryPath}/${file.fileName}`,
    mode: 420,
    writeMode: "overwrite",
    content: `${file.content}\n`,
  }));
}

export function createDesignerReferenceMapSetupFile(): RuntimeClientSetupFile {
  return {
    fileId: "designer_reference_map",
    path: "/root/.mistle/designer/references/reference-map.md",
    mode: 420,
    writeMode: "overwrite",
    content: `${loadDesignerRuntimeReferenceContent(
      DesignerRuntimeReferenceFileNames.REFERENCE_MAP,
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
    createDesignerReferenceMapSetupFile(),
    ...createDesignerIntegrationCatalogSetupFiles(),
    createDesignerAiSoftwareFactoryReferenceSetupFile(),
  ];
}

function loadDesignerRuntimeReferenceDirectoryFiles(
  directoryName: string,
): readonly { fileName: string; content: string }[] {
  const directoryUrl = new URL(`../runtime-references/${directoryName}/`, import.meta.url);
  return readdirSync(directoryUrl)
    .filter((fileName) => fileName.endsWith(".md"))
    .sort()
    .map((fileName) => {
      const content = readFileSync(new URL(fileName, directoryUrl), "utf8").trim();
      if (content.length === 0) {
        throw new Error(
          `Designer runtime reference file '${directoryName}/${fileName}' must not be empty.`,
        );
      }

      return { fileName, content };
    });
}
