import { AppIds, loadConfig } from "@mistle/config";

import { logger } from "./logger.js";
import { createControlPlaneWorkerRuntime } from "./runtime/index.js";

const loadedConfig = loadConfig({
  app: AppIds.CONTROL_PLANE_WORKER,
  env: process.env,
});
if (loadedConfig.global === undefined) {
  throw new Error("Expected global config to be loaded for control-plane-worker.");
}
const runtime = await createControlPlaneWorkerRuntime({
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
      "Failed to gracefully shutdown control-plane-worker",
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
  "control-plane-worker listening",
);
