import {
  assertOpenApiSpecFileIsCurrent,
  getInternalOpenApiSpecFilePath,
  getOpenApiSpecFilePath,
} from "./spec-file.js";

async function run(): Promise<void> {
  await assertOpenApiSpecFileIsCurrent();
  process.stdout.write(`OpenAPI spec is current: ${getOpenApiSpecFilePath()}\n`);
  process.stdout.write(`Internal OpenAPI spec is current: ${getInternalOpenApiSpecFilePath()}\n`);
}

void run().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`OpenAPI spec drift check failed: ${message}\n`);
  process.exit(1);
});
