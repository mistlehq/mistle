import {
  generateControlPlaneSchemaToTemporarySource,
  readGeneratedSchemaFile,
} from "./control-plane-openapi-client.js";

async function run(): Promise<void> {
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

void run().catch((error: unknown) => {
  console.error("OpenAPI client drift check failed", error);
  process.exit(1);
});
