import { logger } from "../logger.js";
import { getOpenApiSpecFilePath, writeOpenApiSpecFile } from "./spec-file.js";

async function run(): Promise<void> {
  await writeOpenApiSpecFile();
  logger.info({ openApiSpecPath: getOpenApiSpecFilePath() }, "Wrote OpenAPI spec");
}

void run().catch((error: unknown) => {
  logger.error({ err: error }, "Failed to generate OpenAPI spec");
  process.exit(1);
});
