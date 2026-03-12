import { generateDataPlaneInternalSchemaFile } from "./data-plane-openapi-client.js";

async function run(): Promise<void> {
  const result = await generateDataPlaneInternalSchemaFile();
  console.log(`Spec: ${result.dataPlaneInternalSpecPath}`);
  console.log(`Generated: ${result.generatedSchemaPath}`);
}

void run().catch((error: unknown) => {
  console.error("Data-plane internal OpenAPI client generation failed", error);
  process.exit(1);
});
