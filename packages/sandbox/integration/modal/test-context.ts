import { ModalClient as ModalSdkClient } from "modal";
import { it as vitestIt } from "vitest";

import {
  SandboxProvider,
  createSandboxAdapter,
  type SandboxAdapter,
  type SandboxImageHandle,
} from "../../src/index.js";
import { resolveSandboxIntegrationSettings } from "../config.js";
import {
  resolveModalAdapterIntegrationSettings,
  type ModalAdapterIntegrationSettings,
} from "./config.js";

export const sandboxIntegrationSettings = resolveSandboxIntegrationSettings(process.env);

export const modalAdapterIntegrationEnabled =
  sandboxIntegrationSettings.enabled &&
  sandboxIntegrationSettings.providers.has(SandboxProvider.MODAL);

export const modalAdapterIntegrationSettings = resolveModalAdapterIntegrationSettings({
  env: process.env,
  enabled: modalAdapterIntegrationEnabled,
});

const SANDBOX_RUNTIME_BASE_REGISTRY_TAG = "ghcr.io/mistlehq/sandbox-base:latest";
const SANDBOX_KEEPALIVE_ENTRYPOINT_COMMAND = 'ENTRYPOINT ["/bin/sh", "-c", "sleep infinity"]';
const SANDBOX_STDIN_PROBE_ENTRYPOINT_COMMAND =
  'ENTRYPOINT ["/bin/sh", "-c", "cat > /tmp/mistle-stdin-bootstrap.sh && /bin/sh /tmp/mistle-stdin-bootstrap.sh"]';

type EnabledModalAdapterIntegrationSettings = Extract<
  ModalAdapterIntegrationSettings,
  { enabled: true }
>;

export type ModalAdapterIntegrationFixture = {
  adapter: SandboxAdapter;
  baseImage: SandboxImageHandle;
  stdinProbeImage: SandboxImageHandle;
  modalClient: ModalSdkClient;
};

export const it = vitestIt.extend<{ fixture: ModalAdapterIntegrationFixture }>({
  fixture: [
    async ({}, use) => {
      const settings = modalAdapterIntegrationSettings;

      if (!settings.enabled) {
        throw new Error(
          'Modal adapter integration fixture requested while modal provider integration is disabled. Set MISTLE_TEST_SANDBOX_INTEGRATION=1 and include "modal" in MISTLE_TEST_SANDBOX_INTEGRATION_PROVIDERS.',
        );
      }

      const adapter = createSandboxAdapter({
        provider: SandboxProvider.MODAL,
        modal: settings.modalConfig,
      });
      const modalClient = new ModalSdkClient({
        tokenId: settings.modalConfig.tokenId,
        tokenSecret: settings.modalConfig.tokenSecret,
        ...(settings.modalConfig.environmentName === undefined
          ? {}
          : { environment: settings.modalConfig.environmentName }),
      });

      try {
        const baseImage = await resolveModalBaseImageHandle({
          modalClient,
          settings,
          entrypointCommand: SANDBOX_KEEPALIVE_ENTRYPOINT_COMMAND,
        });
        const stdinProbeImage = await resolveModalBaseImageHandle({
          modalClient,
          settings,
          entrypointCommand: SANDBOX_STDIN_PROBE_ENTRYPOINT_COMMAND,
        });

        await use({
          adapter,
          baseImage,
          stdinProbeImage,
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
    // This timestamp is metadata for the handle and not sent to Modal start calls.
    createdAt: new Date().toISOString(),
  };
}

async function resolveModalBaseImageHandle(input: {
  modalClient: ModalSdkClient;
  settings: EnabledModalAdapterIntegrationSettings;
  entrypointCommand: string;
}): Promise<SandboxImageHandle> {
  const appLookupOptions =
    input.settings.modalConfig.environmentName === undefined
      ? { createIfMissing: true }
      : {
          createIfMissing: true,
          environment: input.settings.modalConfig.environmentName,
        };
  const app = await input.modalClient.apps.fromName(
    input.settings.modalConfig.appName,
    appLookupOptions,
  );
  const derivedImage = input.modalClient.images
    .fromRegistry(SANDBOX_RUNTIME_BASE_REGISTRY_TAG)
    .dockerfileCommands([input.entrypointCommand]);
  const builtImage = await derivedImage.build(app);

  return createBaseImageHandle(builtImage.imageId);
}
