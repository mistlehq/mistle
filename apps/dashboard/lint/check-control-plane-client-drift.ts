import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  generateControlPlaneSchemaToTemporarySource,
  readGeneratedSchemaFile,
} from "../scripts/control-plane-openapi-client.js";

export async function checkControlPlaneClientDrift() {
  const result = await generateControlPlaneSchemaToTemporarySource();
  const currentSource = await readGeneratedSchemaFile(result.generatedSchemaPath);

  if (currentSource === null) {
    throw new Error(
      `Generated schema does not exist at ${result.generatedSchemaPath}. Run: pnpm --filter @mistle/dashboard openapi:generate`,
    );
  }

  if (currentSource !== result.schemaSource) {
    throw new Error(
      [
        "Dashboard control-plane OpenAPI client schema is out of date.",
        `Spec: ${result.controlPlaneSpecPath}`,
        `Generated: ${result.generatedSchemaPath}`,
        "Run: pnpm --filter @mistle/dashboard openapi:generate",
      ].join("\n"),
    );
  }

  console.log(`Dashboard OpenAPI client schema is current: ${result.generatedSchemaPath}`);
}

async function runCli() {
  try {
    await checkControlPlaneClientDrift();
  } catch (error) {
    console.error("OpenAPI client drift check failed", error);
    process.exit(1);
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void runCli();
}
