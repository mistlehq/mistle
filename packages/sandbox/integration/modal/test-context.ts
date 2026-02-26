import { ModalClient as ModalSdkClient } from "modal";
import { it as vitestIt } from "vitest";

import {
  SandboxImageKind,
  SandboxProvider,
  createSandboxAdapter,
  type SandboxAdapter,
  type SandboxImageHandle,
} from "../../src/index.js";
import { resolveSandboxIntegrationSettings } from "../config.js";
import { resolveModalAdapterIntegrationSettings } from "./config.js";

export const sandboxIntegrationSettings = resolveSandboxIntegrationSettings(process.env);

export const modalAdapterIntegrationEnabled =
  sandboxIntegrationSettings.enabled &&
  sandboxIntegrationSettings.providers.has(SandboxProvider.MODAL);

export const modalAdapterIntegrationSettings = resolveModalAdapterIntegrationSettings({
  env: process.env,
  enabled: modalAdapterIntegrationEnabled,
});

export type ModalAdapterIntegrationFixture = {
  adapter: SandboxAdapter;
  baseImageId: string;
  modalClient: ModalSdkClient;
};

export const it = vitestIt.extend<{ fixture: ModalAdapterIntegrationFixture }>({
  fixture: [
    async ({}, use) => {
      if (!modalAdapterIntegrationSettings.enabled) {
        throw new Error(
          'Modal adapter integration fixture requested while modal provider integration is disabled. Set MISTLE_SANDBOX_INTEGRATION=1 and include "modal" in MISTLE_SANDBOX_INTEGRATION_PROVIDERS.',
        );
      }

      const adapter = createSandboxAdapter({
        provider: SandboxProvider.MODAL,
        modal: modalAdapterIntegrationSettings.modalConfig,
      });
      const modalClient = new ModalSdkClient({
        tokenId: modalAdapterIntegrationSettings.modalConfig.tokenId,
        tokenSecret: modalAdapterIntegrationSettings.modalConfig.tokenSecret,
        ...(modalAdapterIntegrationSettings.modalConfig.environmentName === undefined
          ? {}
          : { environment: modalAdapterIntegrationSettings.modalConfig.environmentName }),
      });

      try {
        await use({
          adapter,
          baseImageId: modalAdapterIntegrationSettings.baseImageId,
          modalClient,
        });
      } finally {
        modalClient.close();
      }
    },
    {
      scope: "file",
    },
  ],
});

export function createBaseImageHandle(baseImageId: string): SandboxImageHandle {
  return {
    provider: SandboxProvider.MODAL,
    imageId: baseImageId,
    kind: SandboxImageKind.BASE,
    // This timestamp is metadata for the handle and not sent to Modal start calls.
    createdAt: new Date().toISOString(),
  };
}
