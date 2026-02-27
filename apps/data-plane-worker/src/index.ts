import { AppIds, loadConfig } from "@mistle/config";

import { logger } from "./logger.js";
import { createDataPlaneWorkerRuntime } from "./runtime/index.js";

const loadedConfig = loadConfig({
  app: AppIds.DATA_PLANE_WORKER,
  env: process.env,
  includeGlobal: false,
});
const appConfig = loadedConfig.app;
const runtime = await createDataPlaneWorkerRuntime(appConfig);

await runtime.start();

let shutdownPromise: Promise<void> | undefined;

async function stopRuntimeAndExit(signal: NodeJS.Signals): Promise<void> {
  try {
    await runtime.stop();
    process.exit(0);
  } catch (error) {
    logger.error(
      {
        err: error,
        signal,
      },
      "Failed to gracefully shutdown data-plane-worker",
    );
    process.exit(1);
  }
}

async function shutdownAndExit(signal: NodeJS.Signals): Promise<void> {
  if (shutdownPromise !== undefined) {
    await shutdownPromise;
    return;
  }

  shutdownPromise = stopRuntimeAndExit(signal);

  await shutdownPromise;
}

process.once("SIGINT", () => {
  void shutdownAndExit("SIGINT");
});

process.once("SIGTERM", () => {
  void shutdownAndExit("SIGTERM");
});

logger.info(
  {
    host: appConfig.server.host,
    port: appConfig.server.port,
  },
  "data-plane-worker listening",
);
