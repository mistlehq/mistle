import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createIntegrationRegistry } from "@mistle/integrations-definitions/server";

import {
  assertDesignerIntegrationCatalogFilesWithinBudget,
  renderDesignerIntegrationCatalogFiles,
} from "../../src/designer/runtime-references/designer-integration-catalog.js";
import { isDirectEntrypoint } from "../script-entrypoint.js";

const DefaultCatalogDirectoryPath = fileURLToPath(
  new URL("../../src/designer/runtime-references/integrations", import.meta.url),
);

export function checkDesignerIntegrationCatalogFiles(input: {
  catalogDirectoryPath?: string;
  startDirectory?: string;
}): void {
  const startDirectory = input.startDirectory ?? process.cwd();
  const catalogDirectoryPath = resolve(
    startDirectory,
    input.catalogDirectoryPath ?? DefaultCatalogDirectoryPath,
  );
  const expectedFiles = renderDesignerIntegrationCatalogFiles(
    createIntegrationRegistry().listDefinitions(),
  );
  assertDesignerIntegrationCatalogFilesWithinBudget(expectedFiles);

  if (!existsSync(catalogDirectoryPath)) {
    throw new Error(
      `Designer integration catalog directory '${catalogDirectoryPath}' does not exist. Run pnpm --filter @mistle/control-plane-api designer:integration-catalog:generate.`,
    );
  }

  const expectedFileNames = expectedFiles.map((file) => file.fileName).sort();
  const actualFileNames = readdirSync(catalogDirectoryPath)
    .filter((fileName) => statSync(resolve(catalogDirectoryPath, fileName)).isFile())
    .sort();
  if (actualFileNames.join("\n") !== expectedFileNames.join("\n")) {
    throw new Error(
      `Designer integration catalog directory '${catalogDirectoryPath}' has stale or missing files. Run pnpm --filter @mistle/control-plane-api designer:integration-catalog:generate.`,
    );
  }

  for (const expectedFile of expectedFiles) {
    const actual = readFileSync(resolve(catalogDirectoryPath, expectedFile.fileName), "utf8");
    if (actual !== expectedFile.markdown) {
      throw new Error(
        `Designer integration catalog file '${expectedFile.fileName}' is out of date. Run pnpm --filter @mistle/control-plane-api designer:integration-catalog:generate.`,
      );
    }
  }
}

if (isDirectEntrypoint({ argvPath: process.argv[1], moduleUrl: import.meta.url })) {
  try {
    checkDesignerIntegrationCatalogFiles({});
    console.log("Designer integration catalog is up to date.");
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}
