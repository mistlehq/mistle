import { createControlPlaneAuth } from "./auth/index.js";
import type { AppRuntimeResources } from "./resources.js";
import type { AppServices, ControlPlaneApiRuntimeConfig } from "./types.js";

type CreateAppServicesInput = {
  runtimeConfig: ControlPlaneApiRuntimeConfig;
  resources: Pick<AppRuntimeResources, "db" | "integrationRegistry" | "openWorkflow">;
};

export function createAppServices(input: CreateAppServicesInput): AppServices {
  const { runtimeConfig, resources } = input;
  const { app: config } = runtimeConfig;

  return {
    auth: createControlPlaneAuth({
      config: {
        authBaseUrl: config.auth.baseUrl,
        dashboardBaseUrl: config.dashboard.baseUrl,
        authSecret: config.auth.secret,
        authTrustedOrigins: config.auth.trustedOrigins,
        authOTPLength: config.auth.otpLength,
        authOTPExpiresInSeconds: config.auth.otpExpiresInSeconds,
        authOTPAllowedAttempts: config.auth.otpAllowedAttempts,
        activeMasterEncryptionKeyVersion: config.integrations.activeMasterEncryptionKeyVersion,
        masterEncryptionKeys: config.integrations.masterEncryptionKeys,
      },
      db: resources.db,
      openWorkflow: resources.openWorkflow,
    }),
  };
}
