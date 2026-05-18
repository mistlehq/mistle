import { createDataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";

import { createApp } from "./app.js";
import type { ControlPlaneAuthConfig } from "./auth/index.js";
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
  const { app: config } = runtimeConfig;
  const dataPlaneClient = createDataPlaneClient({
    config,
  });
  const authConfig = createAuthConfig(config);
  let app: ControlPlaneApp;

  try {
    const appContext = await resources.getAppContext({
      authConfig,
    });

    app = createApp({
      config,
      environment: runtimeConfig.global.env,
      sandboxConfig: config.sandbox,
      internalAuthServiceToken: config.internalAuth.serviceToken,
      db: appContext.db,
      objectStore: resources.objectStore,
      integrationRegistry: resources.integrationRegistry,
      dataPlaneClient,
      connectionTokenConfig: config.connectionToken,
      portAccessConfig: config.portAccess,
      ptyTransportConfig: config.ptyTransport,
      openWorkflow: appContext.openWorkflow,
      auth: appContext.auth,
      resolveTestContext: async ({ testEnvironmentId }) => ({
        ...(await resources.getAppContext({
          authConfig,
          testEnvironmentId,
        })),
        dataPlaneClient: createDataPlaneClient({
          config,
          testEnvironmentId,
        }),
      }),
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

function createDataPlaneClient(input: {
  config: ControlPlaneApiRuntimeConfig["app"];
  testEnvironmentId?: string;
}) {
  const testIsolation = input.config.__dangerouslyEnableTestIsolation;

  return createDataPlaneSandboxInstancesClient({
    baseUrl: input.config.dataPlaneApi.baseUrl,
    serviceToken: input.config.internalAuth.serviceToken,
    ...(input.testEnvironmentId === undefined
      ? {}
      : {
          testEnvironmentId: input.testEnvironmentId,
        }),
    ...(testIsolation === undefined
      ? {}
      : {
          testEnvironmentIdHeader: testIsolation.testEnvironmentIdHeader,
        }),
  });
}

function createAuthConfig(config: ControlPlaneApiRuntimeConfig["app"]): ControlPlaneAuthConfig {
  return {
    authBaseUrl: config.auth.baseUrl,
    dashboardBaseUrl: config.dashboard.baseUrl,
    authSecret: config.auth.secret,
    authTrustedOrigins: config.auth.trustedOrigins,
    authAllowSignups: config.auth.allowSignups,
    authOTPLength: config.auth.otpLength,
    authOTPExpiresInSeconds: config.auth.otpExpiresInSeconds,
    authOTPAllowedAttempts: config.auth.otpAllowedAttempts,
    authGoogleClientId: config.auth.google?.clientId ?? null,
    authGoogleClientSecret: config.auth.google?.clientSecret ?? null,
    ...(config.__dangerouslyEnableTestIsolation?.googleAuth === undefined
      ? {}
      : {
          authGoogleProviderOverrides: config.__dangerouslyEnableTestIsolation.googleAuth,
        }),
    activeMasterEncryptionKeyVersion: config.integrations.activeMasterEncryptionKeyVersion,
    masterEncryptionKeys: config.integrations.masterEncryptionKeys,
    billing: config.billing,
  };
}
