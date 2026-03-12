import {
  generateDataPlaneInternalSchemaToTemporarySource,
  readGeneratedSchemaFile,
} from "./data-plane-openapi-client.js";

async function run(): Promise<void> {
  const result = await generateDataPlaneInternalSchemaToTemporarySource();
  const currentSource = await readGeneratedSchemaFile(result.generatedSchemaPath);

  if (currentSource === null) {
    throw new Error(
      [
        `Generated schema does not exist at ${result.generatedSchemaPath}.`,
        "Run: pnpm --filter @mistle/data-plane-internal-client openapi:generate",
      ].join(" "),
    );
  }

  if (currentSource !== result.schemaSource) {
    throw new Error(
      [
        "Data-plane internal OpenAPI client schema is out of date.",
        `Spec: ${result.dataPlaneInternalSpecPath}`,
        `Generated: ${result.generatedSchemaPath}`,
        "Run: pnpm --filter @mistle/data-plane-internal-client openapi:generate",
      ].join("\n"),
    );
  }

  console.log(
    `Data-plane internal OpenAPI client schema is current: ${result.generatedSchemaPath}`,
  );
}

void run().catch((error: unknown) => {
  console.error("Data-plane internal OpenAPI client drift check failed", error);
  process.exit(1);
});
