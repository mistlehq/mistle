import { createDataPlaneSandboxInstancesClient } from "@mistle/data-plane-trpc/client";

import { createControlPlaneAuth } from "./auth/index.js";
import type { AppRuntimeResources } from "./runtime/resources.js";
import { createSandboxInstancesService } from "./sandbox-instances/index.js";
import { createSandboxProfilesService } from "./sandbox-profiles/index.js";
import type { AppServices, ControlPlaneApiRuntimeConfig } from "./types.js";

type CreateAppServicesInput = {
  runtimeConfig: ControlPlaneApiRuntimeConfig;
  resources: Pick<AppRuntimeResources, "db" | "openWorkflow">;
};

export function createAppServices(input: CreateAppServicesInput): AppServices {
  const { runtimeConfig, resources } = input;
  const { app: config } = runtimeConfig;

  const dataPlaneClient = createDataPlaneSandboxInstancesClient({
    baseUrl: config.dataPlaneApi.baseUrl,
    serviceToken: runtimeConfig.internalAuthServiceToken,
  });
  const sandboxInstancesService = createSandboxInstancesService({
    dataPlaneClient,
  });
  const sandboxProfilesService = createSandboxProfilesService({
    db: resources.db,
    openWorkflow: resources.openWorkflow,
    mintSandboxInstanceConnectionToken: sandboxInstancesService.mintConnectionToken,
    defaultConnectionToken: {
      gatewayWebsocketUrl: config.sandbox.gatewayWsUrl,
      tokenTtlSeconds: config.sandbox.bootstrapTokenTtlSeconds,
      tokenConfig: {
        bootstrapTokenSecret: runtimeConfig.tunnel.bootstrapTokenSecret,
        tokenIssuer: runtimeConfig.tunnel.tokenIssuer,
        tokenAudience: runtimeConfig.tunnel.tokenAudience,
      },
    },
  });

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
    sandboxProfiles: sandboxProfilesService,
    sandboxInstances: sandboxInstancesService,
  };
}
