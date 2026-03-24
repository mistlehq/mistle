import { getInternalOpenApiSpecFilePath, writeOpenApiSpecFile } from "./spec-file.js";

async function run(): Promise<void> {
  await writeOpenApiSpecFile();
  process.stdout.write(`Wrote OpenAPI spec: ${getInternalOpenApiSpecFilePath()}\n`);
}

void run().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`Failed to generate OpenAPI spec: ${message}\n`);
  process.exit(1);
});
