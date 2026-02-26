import { AppIds, loadConfig } from "@mistle/config";

import { createDataPlaneApiRuntime } from "./runtime/index.js";

async function startDataPlaneApi(): Promise<void> {
  const loadedConfig = loadConfig({
    app: AppIds.DATA_PLANE_API,
    env: process.env,
    includeGlobal: false,
  });
  const appConfig = loadedConfig.app;
  const runtime = await createDataPlaneApiRuntime(appConfig);

  runtime.start();

  let shutdownPromise: Promise<void> | undefined;

  async function stopRuntimeAndExit(signal: NodeJS.Signals): Promise<void> {
    try {
      await runtime.stop();
      process.exit(0);
    } catch (error) {
      console.error("Failed to gracefully shutdown data-plane-api after", signal, error);
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

  console.log(
    "@mistle/data-plane-api listening on " +
      appConfig.server.host +
      ":" +
      String(appConfig.server.port),
  );
}

void startDataPlaneApi().catch((error) => {
  console.error("Failed to start data-plane-api", error);
  process.exit(1);
});
