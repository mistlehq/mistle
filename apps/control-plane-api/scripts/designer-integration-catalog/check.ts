import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createIntegrationRegistry } from "@mistle/integrations-definitions/server";

import {
  assertDesignerIntegrationCatalogWithinBudget,
  renderDesignerIntegrationCatalogMarkdown,
} from "../../src/designer/runtime-references/designer-integration-catalog.js";
import { isDirectEntrypoint } from "../script-entrypoint.js";

const DefaultCatalogPath = fileURLToPath(
  new URL("../../src/designer/runtime-references/integration-catalog.md", import.meta.url),
);

export function checkDesignerIntegrationCatalogFile(input: {
  catalogPath?: string;
  startDirectory?: string;
}): void {
  const startDirectory = input.startDirectory ?? process.cwd();
  const catalogPath = resolve(startDirectory, input.catalogPath ?? DefaultCatalogPath);
  const expected = renderDesignerIntegrationCatalogMarkdown(
    createIntegrationRegistry().listDefinitions(),
  );
  assertDesignerIntegrationCatalogWithinBudget(expected);

  if (!existsSync(catalogPath)) {
    throw new Error(
      `Designer integration catalog '${catalogPath}' does not exist. Run pnpm --filter @mistle/control-plane-api designer:integration-catalog:generate.`,
    );
  }

  const actual = readFileSync(catalogPath, "utf8");
  if (actual !== expected) {
    throw new Error(
      `Designer integration catalog '${catalogPath}' is out of date. Run pnpm --filter @mistle/control-plane-api designer:integration-catalog:generate.`,
    );
  }
}

if (isDirectEntrypoint({ argvPath: process.argv[1], moduleUrl: import.meta.url })) {
  try {
    checkDesignerIntegrationCatalogFile({});
    console.log("Designer integration catalog is up to date.");
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}
