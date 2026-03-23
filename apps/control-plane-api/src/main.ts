import { createDataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";

import { createApp } from "./app.js";
import { createAppResources, stopAppResources } from "./resources.js";
import { startServer } from "./server.js";
import { createAppServices } from "./service.js";
import type {
  ControlPlaneApiRuntime,
  ControlPlaneApiRuntimeConfig,
  ControlPlaneApp,
  StartedServer,
} from "./types.js";

export async function createControlPlaneApiRuntime(
  runtimeConfig: ControlPlaneApiRuntimeConfig,
): Promise<ControlPlaneApiRuntime> {
  const resources = await createAppResources(runtimeConfig.app);
  const dataPlaneClient = createDataPlaneSandboxInstancesClient({
    baseUrl: runtimeConfig.app.dataPlaneApi.baseUrl,
    serviceToken: runtimeConfig.internalAuthServiceToken,
  });
  let app: ControlPlaneApp;

  try {
    const services = createAppServices({
      runtimeConfig,
      resources,
    });

    app = createApp({
      config: runtimeConfig.app,
      sandboxConfig: runtimeConfig.sandbox,
      internalAuthServiceToken: runtimeConfig.internalAuthServiceToken,
      db: resources.db,
      integrationRegistry: resources.integrationRegistry,
      dataPlaneClient,
      connectionTokenConfig: runtimeConfig.connectionToken,
      openWorkflow: resources.openWorkflow,
      services,
    });
  } catch (error) {
    await stopAppResources(resources);
    throw error;
  }

  let startedServer: StartedServer | undefined;
  let stopPromise: Promise<void> | undefined;
  let stopped = false;

  async function stopRuntimeResources(): Promise<void> {
    if (startedServer !== undefined) {
      await startedServer.close();
      startedServer = undefined;
    }

    await stopAppResources(resources);
    stopped = true;
  }

  return {
    app,
    db: resources.db,
    request: app.request,
    start: async () => {
      if (stopped) {
        throw new Error("Control plane API runtime is already stopped.");
      }
      if (startedServer !== undefined) {
        throw new Error("Control plane API server is already started.");
      }

      startedServer = startServer({
        app,
        host: runtimeConfig.app.server.host,
        port: runtimeConfig.app.server.port,
      });
    },
    stop: async () => {
      if (stopped) {
        return;
      }
      if (stopPromise !== undefined) {
        await stopPromise;
        return;
      }

      stopPromise = stopRuntimeResources();

      await stopPromise;
    },
  };
}
