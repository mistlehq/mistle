import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createIntegrationRegistry } from "@mistle/integrations-definitions/server";

import {
  assertDesignerIntegrationCatalogWithinBudget,
  DesignerIntegrationCatalogSourcePath,
  renderDesignerIntegrationCatalogMarkdown,
} from "../../src/designer/runtime-references/designer-integration-catalog.js";
import { isDirectEntrypoint } from "../script-entrypoint.js";

const DefaultOutputPath = fileURLToPath(
  new URL("../../src/designer/runtime-references/integration-catalog.md", import.meta.url),
);

export function generateDesignerIntegrationCatalogFile(input: {
  outputPath?: string;
  startDirectory?: string;
}): string {
  const startDirectory = input.startDirectory ?? process.cwd();
  const outputPath =
    input.outputPath === undefined ? DefaultOutputPath : resolve(startDirectory, input.outputPath);
  const markdown = renderDesignerIntegrationCatalogMarkdown(
    createIntegrationRegistry().listDefinitions(),
  );
  assertDesignerIntegrationCatalogWithinBudget(markdown);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, markdown, "utf8");
  return input.outputPath === undefined ? DesignerIntegrationCatalogSourcePath : outputPath;
}

if (isDirectEntrypoint({ argvPath: process.argv[1], moduleUrl: import.meta.url })) {
  try {
    const outputPath = generateDesignerIntegrationCatalogFile({});
    console.log(`Generated ${outputPath}`);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}
