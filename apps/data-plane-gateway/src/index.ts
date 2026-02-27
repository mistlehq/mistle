import { AppIds, loadConfig } from "@mistle/config";

import { logger } from "./logger.js";
import { createDataPlaneGatewayRuntime } from "./runtime/index.js";

const loadedConfig = loadConfig({
  app: AppIds.DATA_PLANE_GATEWAY,
  env: process.env,
});
if (loadedConfig.global === undefined) {
  throw new Error("Expected global tunnel config to be loaded for data-plane-gateway.");
}

const runtime = createDataPlaneGatewayRuntime({
  app: loadedConfig.app,
  tunnel: loadedConfig.global.tunnel,
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
      "Failed to gracefully shutdown data-plane-gateway",
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
  "data-plane-gateway listening",
);
