import { AppIds, loadConfig } from "@mistle/config";

import { logger } from "./logger.js";
import { createDataPlaneApiRuntime } from "./runtime/index.js";

async function startDataPlaneApi(): Promise<void> {
  const loadedConfig = loadConfig({
    app: AppIds.DATA_PLANE_API,
    env: process.env,
  });
  if (loadedConfig.global === undefined) {
    throw new Error("Expected global config to be loaded for data-plane-api.");
  }
  const runtime = await createDataPlaneApiRuntime({
    app: loadedConfig.app,
    internalAuthServiceToken: loadedConfig.global.internalAuth.serviceToken,
  });

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
        "Failed to gracefully shutdown data-plane-api",
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
      host: loadedConfig.app.server.host,
      port: loadedConfig.app.server.port,
    },
    "data-plane-api listening",
  );
}

void startDataPlaneApi().catch((error) => {
  logger.error({ err: error }, "Failed to start data-plane-api");
  process.exit(1);
});
