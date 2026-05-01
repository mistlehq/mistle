import { createDataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";

import { createApp } from "./app.js";
import { createControlPlaneAuth, type ControlPlaneAuthConfig } from "./auth/index.js";
import { createAppResources, stopAppResources } from "./resources.js";
import { startServer } from "./server.js";
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
    serviceToken: runtimeConfig.app.internalAuth.serviceToken,
  });
  const { app: config } = runtimeConfig;
  const authConfig = createAuthConfig(config);
  const testAuthByEnvironmentId = new Map<string, ReturnType<typeof createControlPlaneAuth>>();
  let app: ControlPlaneApp;

  try {
    const auth = createControlPlaneAuth({
      config: authConfig,
      db: resources.db,
      openWorkflow: resources.openWorkflow,
    });

    app = createApp({
      config,
      sandboxConfig: config.sandbox,
      internalAuthServiceToken: config.internalAuth.serviceToken,
      db: resources.db,
      objectStore: resources.objectStore,
      integrationRegistry: resources.integrationRegistry,
      dataPlaneClient,
      connectionTokenConfig: config.connectionToken,
      portAccessConfig: config.portAccess,
      openWorkflow: resources.openWorkflow,
      auth,
      resolveTestContext: async ({ testEnvironmentId }) => {
        const db = resources.getDb({ testEnvironmentId });
        const openWorkflow = await resources.getOpenWorkflow({ testEnvironmentId });
        let testAuth = testAuthByEnvironmentId.get(testEnvironmentId);
        if (testAuth === undefined) {
          testAuth = createControlPlaneAuth({
            config: authConfig,
            db,
            openWorkflow,
          });
          testAuthByEnvironmentId.set(testEnvironmentId, testAuth);
        }

        return {
          db,
          openWorkflow,
          auth: testAuth,
        };
      },
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

function createAuthConfig(config: ControlPlaneApiRuntimeConfig["app"]): ControlPlaneAuthConfig {
  return {
    authBaseUrl: config.auth.baseUrl,
    dashboardBaseUrl: config.dashboard.baseUrl,
    authSecret: config.auth.secret,
    authTrustedOrigins: config.auth.trustedOrigins,
    authOTPLength: config.auth.otpLength,
    authOTPExpiresInSeconds: config.auth.otpExpiresInSeconds,
    authOTPAllowedAttempts: config.auth.otpAllowedAttempts,
    authGoogleClientId: config.auth.google?.clientId ?? null,
    authGoogleClientSecret: config.auth.google?.clientSecret ?? null,
    activeMasterEncryptionKeyVersion: config.integrations.activeMasterEncryptionKeyVersion,
    masterEncryptionKeys: config.integrations.masterEncryptionKeys,
  };
}
