import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createIntegrationRegistry } from "@mistle/integrations-definitions/server";

import {
  assertDesignerIntegrationCatalogFilesWithinBudget,
  DesignerIntegrationCatalogSourceDirectoryPath,
  renderDesignerIntegrationCatalogFiles,
} from "../../src/designer/runtime-references/designer-integration-catalog.js";
import { isDirectEntrypoint } from "../script-entrypoint.js";

const DefaultOutputDirectoryPath = fileURLToPath(
  new URL("../../src/designer/runtime-references/integrations", import.meta.url),
);

export function generateDesignerIntegrationCatalogFiles(input: {
  outputDirectoryPath?: string;
  startDirectory?: string;
}): string {
  const startDirectory = input.startDirectory ?? process.cwd();
  const outputDirectoryPath =
    input.outputDirectoryPath === undefined
      ? DefaultOutputDirectoryPath
      : resolve(startDirectory, input.outputDirectoryPath);
  const files = renderDesignerIntegrationCatalogFiles(
    createIntegrationRegistry().listDefinitions(),
  );
  assertDesignerIntegrationCatalogFilesWithinBudget(files);
  rmSync(outputDirectoryPath, { recursive: true, force: true });
  mkdirSync(outputDirectoryPath, { recursive: true });
  for (const file of files) {
    const outputPath = resolve(outputDirectoryPath, file.fileName);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, file.markdown, "utf8");
  }

  return input.outputDirectoryPath === undefined
    ? DesignerIntegrationCatalogSourceDirectoryPath
    : outputDirectoryPath;
}

if (isDirectEntrypoint({ argvPath: process.argv[1], moduleUrl: import.meta.url })) {
  try {
    const outputDirectoryPath = generateDesignerIntegrationCatalogFiles({});
    console.log(`Generated ${outputDirectoryPath}`);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}
