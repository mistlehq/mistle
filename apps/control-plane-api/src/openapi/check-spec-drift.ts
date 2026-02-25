import { assertOpenApiSpecFileIsCurrent, getOpenApiSpecFilePath } from "./spec-file.js";

async function run(): Promise<void> {
  await assertOpenApiSpecFileIsCurrent();
  console.log(`OpenAPI spec is current: ${getOpenApiSpecFilePath()}`);
}

void run().catch((error: unknown) => {
  console.error("OpenAPI spec drift check failed", error);
  process.exit(1);
});
