import { createDataPlaneSandboxInstancesClient } from "@mistle/data-plane-trpc/client";
import { HandleIntegrationWebhookEventWorkflowSpec } from "@mistle/workflows/control-plane";

import { createControlPlaneAuth } from "./auth/index.js";
import { createIntegrationConnectionsService } from "./integration-connections/index.js";
import type { AppRuntimeResources } from "./runtime/resources.js";
import { SANDBOX_INSTANCE_CONNECTION_TOKEN_TTL_SECONDS } from "./sandbox-instances/constants.js";
import { createSandboxInstancesService } from "./sandbox-instances/index.js";
import { createSandboxProfilesService } from "./sandbox-profiles/index.js";
import type { AppServices, ControlPlaneApiRuntimeConfig } from "./types.js";

type CreateAppServicesInput = {
  runtimeConfig: ControlPlaneApiRuntimeConfig;
  resources: Pick<AppRuntimeResources, "db" | "integrationRegistry" | "openWorkflow">;
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
    defaultConnectionToken: {
      gatewayWebsocketUrl: runtimeConfig.sandbox.gatewayWsUrl,
      tokenTtlSeconds: SANDBOX_INSTANCE_CONNECTION_TOKEN_TTL_SECONDS,
      tokenConfig: {
        connectionTokenSecret: runtimeConfig.connectionToken.secret,
        tokenIssuer: runtimeConfig.connectionToken.issuer,
        tokenAudience: runtimeConfig.connectionToken.audience,
      },
    },
  });
  const sandboxProfilesService = createSandboxProfilesService({
    db: resources.db,
    openWorkflow: resources.openWorkflow,
    integrationsConfig: config.integrations,
    dataPlaneClient,
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
    integrationConnections: createIntegrationConnectionsService({
      db: resources.db,
      integrationRegistry: resources.integrationRegistry,
      openWorkflow: resources.openWorkflow,
    }),
    integrationWebhooks: {
      receiveWebhookEvent: async (workflowInput) => {
        await resources.openWorkflow.runWorkflow(
          HandleIntegrationWebhookEventWorkflowSpec,
          workflowInput,
          {
            idempotencyKey: workflowInput.webhookEventId,
          },
        );
      },
    },
    sandboxProfiles: sandboxProfilesService,
    sandboxInstances: sandboxInstancesService,
  };
}
