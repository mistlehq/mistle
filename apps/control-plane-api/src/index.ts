import { AppIds, loadConfig } from "@mistle/config";

import { logger } from "./logger.js";
import { createControlPlaneApiRuntime } from "./runtime/index.js";

async function startControlPlaneApi(): Promise<void> {
  const loadedConfig = loadConfig({
    app: AppIds.CONTROL_PLANE_API,
    env: process.env,
    includeGlobal: false,
  });
  const appConfig = loadedConfig.app;
  const runtime = await createControlPlaneApiRuntime(appConfig);

  runtime.start();

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
        "Failed to gracefully shutdown control-plane-api",
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
      authBaseUrl: appConfig.auth.baseUrl,
      host: appConfig.server.host,
      port: appConfig.server.port,
    },
    "control-plane-api listening",
  );
}

void startControlPlaneApi().catch((error) => {
  logger.error({ err: error }, "Failed to start control-plane-api");
  process.exit(1);
});
