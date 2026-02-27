import { StartSandboxInstanceInputSchema } from "@mistle/data-plane-trpc/contracts";

import type { AppRuntimeResources } from "./runtime/resources.js";
import type { AppServices, ControlPlaneApiConfig } from "./types.js";

import { createControlPlaneAuth } from "./auth/index.js";
import { createSandboxProfilesService } from "./sandbox-profiles/index.js";

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
      },
      db: resources.db,
      openWorkflow: resources.openWorkflow,
    }),
    sandboxProfiles: createSandboxProfilesService({
      db: resources.db,
      openWorkflow: resources.openWorkflow,
      resolveSandboxProfileVersionImage: async (resolverInput) => {
        const parsedManifest = StartSandboxInstanceInputSchema.shape.manifest.safeParse(
          resolverInput.manifest,
        );
        if (!parsedManifest.success) {
          throw new Error("Sandbox profile version manifest is invalid.");
        }

        const parsedImage = StartSandboxInstanceInputSchema.shape.image.safeParse(
          parsedManifest.data.image,
        );
        if (!parsedImage.success) {
          throw new Error("Sandbox profile version image is invalid.");
        }

        return parsedImage.data;
      },
    }),
  };
}
