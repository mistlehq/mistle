import { AppIds, loadConfig } from "@mistle/config";

import { createControlPlaneWorkerRuntime } from "./runtime.js";

const loadedConfig = loadConfig({
  app: AppIds.CONTROL_PLANE_WORKER,
  env: process.env,
  includeGlobal: false,
});
const appConfig = loadedConfig.app;
const runtime = await createControlPlaneWorkerRuntime(appConfig);

await runtime.start();

let shutdownPromise: Promise<void> | undefined;

async function stopRuntimeAndExit(signal: NodeJS.Signals): Promise<void> {
  try {
    await runtime.stop();
    process.exit(0);
  } catch (error) {
    console.error("Failed to gracefully shutdown control-plane-worker after", signal, error);
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
  "@mistle/control-plane-worker listening on " +
    appConfig.server.host +
    ":" +
    String(appConfig.server.port),
);
