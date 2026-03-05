import {
  generateInternalControlPlaneSchemaToTemporarySource,
  readGeneratedSchemaFile,
} from "./internal-openapi-client.js";

async function run(): Promise<void> {
  const result = await generateInternalControlPlaneSchemaToTemporarySource();
  const currentSource = await readGeneratedSchemaFile(result.generatedSchemaPath);

  if (currentSource === null) {
    throw new Error(
      [
        `Generated schema does not exist at ${result.generatedSchemaPath}.`,
        "Run: pnpm --filter @mistle/control-plane-internal-client openapi:generate",
      ].join(" "),
    );
  }

  if (currentSource !== result.schemaSource) {
    throw new Error(
      [
        "Control-plane internal OpenAPI client schema is out of date.",
        `Spec: ${result.controlPlaneInternalSpecPath}`,
        `Generated: ${result.generatedSchemaPath}`,
        "Run: pnpm --filter @mistle/control-plane-internal-client openapi:generate",
      ].join("\n"),
    );
  }

  console.log(
    `Control-plane internal OpenAPI client schema is current: ${result.generatedSchemaPath}`,
  );
}

void run().catch((error: unknown) => {
  console.error("Internal OpenAPI client drift check failed", error);
  process.exit(1);
});
