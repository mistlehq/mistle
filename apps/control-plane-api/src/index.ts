import { shutdownTelemetry } from "@mistle/telemetry";

import { appConfig, globalConfig } from "./instrument.js";
import { logger } from "./logger.js";
import { createControlPlaneApiRuntime } from "./main.js";

async function startControlPlaneApi(): Promise<void> {
  const runtime = await createControlPlaneApiRuntime({
    app: appConfig,
    internalAuthServiceToken: globalConfig.internalAuth.serviceToken,
    connectionToken: {
      secret: globalConfig.sandbox.connect.tokenSecret,
      issuer: globalConfig.sandbox.connect.tokenIssuer,
      audience: globalConfig.sandbox.connect.tokenAudience,
    },
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
        "Failed to gracefully shutdown control-plane-api",
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
      authBaseUrl: appConfig.auth.baseUrl,
      host: appConfig.server.host,
      port: appConfig.server.port,
    },
    "control-plane-api listening",
  );
}

void startControlPlaneApi().catch(async (error) => {
  logger.error({ err: error }, "Failed to start control-plane-api");
  await shutdownTelemetry();
  process.exit(1);
});
