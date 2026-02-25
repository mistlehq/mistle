import { getOpenApiSpecFilePath, writeOpenApiSpecFile } from "./spec-file.js";

async function run(): Promise<void> {
  await writeOpenApiSpecFile();
  console.log(`Wrote OpenAPI spec to ${getOpenApiSpecFilePath()}`);
}

void run().catch((error: unknown) => {
  console.error("Failed to generate OpenAPI spec", error);
  process.exit(1);
});
