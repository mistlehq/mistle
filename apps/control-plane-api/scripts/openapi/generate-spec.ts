import { logger } from "../../src/logger.js";
import {
  getInternalOpenApiSpecFilePath,
  getOpenApiSpecFilePath,
  writeOpenApiSpecFile,
} from "./spec-file.js";

async function run(): Promise<void> {
  await writeOpenApiSpecFile();
  logger.info(
    {
      openApiSpecPath: getOpenApiSpecFilePath(),
      internalOpenApiSpecPath: getInternalOpenApiSpecFilePath(),
    },
    "Wrote OpenAPI specs",
  );
}

void run().catch((error: unknown) => {
  logger.error({ err: error }, "Failed to generate OpenAPI spec");
  process.exit(1);
});
