import { generateControlPlaneSchemaFile } from "./control-plane-openapi-client.js";

async function run(): Promise<void> {
  const result = await generateControlPlaneSchemaFile();

  console.log(
    `Generated dashboard control-plane client schema: ${result.generatedSchemaPath} (source: ${result.controlPlaneSpecPath})`,
  );
}

void run().catch((error: unknown) => {
  console.error("Failed to generate dashboard control-plane client schema", error);
  process.exit(1);
});
