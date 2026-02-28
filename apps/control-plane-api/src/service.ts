import { createControlPlaneAuth } from "./auth/index.js";
import type { AppRuntimeResources } from "./runtime/resources.js";
import { createSandboxProfilesService } from "./sandbox-profiles/index.js";
import type { AppServices, ControlPlaneApiConfig } from "./types.js";

type CreateAppServicesInput = {
  config: ControlPlaneApiConfig;
  resources: Pick<AppRuntimeResources, "db" | "openWorkflow">;
};

export function createAppServices(input: CreateAppServicesInput): AppServices {
  const { config, resources } = input;

  return {
    auth: createControlPlaneAuth({
      config: {
        authBaseUrl: config.auth.baseUrl,
        authInvitationAcceptBaseUrl: config.auth.invitationAcceptBaseUrl,
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
    sandboxProfiles: createSandboxProfilesService({
      db: resources.db,
      openWorkflow: resources.openWorkflow,
    }),
  };
}
