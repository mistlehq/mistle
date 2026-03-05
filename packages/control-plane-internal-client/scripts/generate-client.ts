import { generateInternalControlPlaneSchemaFile } from "./internal-openapi-client.js";

async function run(): Promise<void> {
  const result = await generateInternalControlPlaneSchemaFile();
  console.log(`Spec: ${result.controlPlaneInternalSpecPath}`);
  console.log(`Generated: ${result.generatedSchemaPath}`);
}

void run().catch((error: unknown) => {
  console.error("Internal control-plane OpenAPI client generation failed", error);
  process.exit(1);
});
