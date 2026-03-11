import { shutdownTelemetry } from "@mistle/telemetry";

import { appConfig, globalConfig } from "./instrument.js";
import { logger } from "./logger.js";
import { createControlPlaneWorkerRuntime } from "./runtime/index.js";
const runtime = await createControlPlaneWorkerRuntime({
  app: appConfig,
  internalAuthServiceToken: globalConfig.internalAuth.serviceToken,
  sandbox: {
    defaultBaseImage: globalConfig.sandbox.defaultBaseImage,
    gatewayWsUrl: globalConfig.sandbox.gatewayWsUrl,
  },
});

await runtime.start();

let shutdownPromise: Promise<void> | undefined;

async function stopRuntimeAndExit(signal: NodeJS.Signals): Promise<void> {
  try {
    await runtime.stop();
    await shutdownTelemetry();
    process.exit(0);
  } catch (error) {
    logger.error(
      {
        err: error,
        signal,
      },
      "Failed to gracefully shutdown control-plane-worker",
    );
    await shutdownTelemetry();
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
  "control-plane-worker listening",
);
