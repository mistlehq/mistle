import { shutdownTelemetry } from "@mistle/telemetry";

import { appConfig, globalConfig } from "./instrument.js";
import { logger } from "./logger.js";
import { createTokenizerProxyRuntime } from "./runtime/index.js";

const runtime = createTokenizerProxyRuntime({
  app: appConfig,
  internalAuthServiceToken: globalConfig.internalAuth.serviceToken,
  egressGrantConfig: globalConfig.sandbox.egress,
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
      "Failed to gracefully shutdown tokenizer-proxy",
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
  "tokenizer-proxy listening",
);
