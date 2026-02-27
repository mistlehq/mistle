import { logger } from "../logger.js";
import { assertOpenApiSpecFileIsCurrent, getOpenApiSpecFilePath } from "./spec-file.js";

async function run(): Promise<void> {
  await assertOpenApiSpecFileIsCurrent();
  logger.info({ openApiSpecPath: getOpenApiSpecFilePath() }, "OpenAPI spec is current");
}

void run().catch((error: unknown) => {
  logger.error({ err: error }, "OpenAPI spec drift check failed");
  process.exit(1);
});
