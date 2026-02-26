import { ModalClient as ModalSdkClient } from "modal";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { it as vitestIt } from "vitest";

import {
  SandboxImageKind,
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

const SANDBOX_RUNTIME_BASE_DOCKERFILE_PATH = fileURLToPath(
  new URL("../../../../apps/sandbox-runtime/images/base/Dockerfile", import.meta.url),
);
const SANDBOX_RUNTIME_BASE_STAGE_NAME = "sandbox-base-prod";
const SANDBOX_KEEPALIVE_ENTRYPOINT_COMMAND = 'ENTRYPOINT ["/bin/sh", "-c", "sleep infinity"]';

type EnabledModalAdapterIntegrationSettings = Extract<
  ModalAdapterIntegrationSettings,
  { enabled: true }
>;

export type ModalAdapterIntegrationFixture = {
  adapter: SandboxAdapter;
  baseImage: SandboxImageHandle;
  modalClient: ModalSdkClient;
};

export const it = vitestIt.extend<{ fixture: ModalAdapterIntegrationFixture }>({
  fixture: [
    async ({}, use) => {
      const settings = modalAdapterIntegrationSettings;

      if (!settings.enabled) {
        throw new Error(
          'Modal adapter integration fixture requested while modal provider integration is disabled. Set MISTLE_SANDBOX_INTEGRATION=1 and include "modal" in MISTLE_SANDBOX_INTEGRATION_PROVIDERS.',
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
        });

        await use({
          adapter,
          baseImage,
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

async function resolveModalBaseImageHandle(input: {
  modalClient: ModalSdkClient;
  settings: EnabledModalAdapterIntegrationSettings;
}): Promise<SandboxImageHandle> {
  const runtimeBaseRegistryTag = await readSandboxRuntimeBaseRegistryTag();
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
    .fromRegistry(runtimeBaseRegistryTag)
    .dockerfileCommands([SANDBOX_KEEPALIVE_ENTRYPOINT_COMMAND]);
  const builtImage = await derivedImage.build(app);

  return createBaseImageHandle(builtImage.imageId);
}

async function readSandboxRuntimeBaseRegistryTag(): Promise<string> {
  const dockerfileContent = await readFile(SANDBOX_RUNTIME_BASE_DOCKERFILE_PATH, "utf8");
  const runtimeBaseImagePattern = new RegExp(
    `^FROM\\s+([^\\s]+)\\s+AS\\s+${SANDBOX_RUNTIME_BASE_STAGE_NAME}\\s*$`,
    "im",
  );
  const runtimeBaseImageMatch = dockerfileContent.match(runtimeBaseImagePattern);

  if (runtimeBaseImageMatch === null || runtimeBaseImageMatch[1] === undefined) {
    throw new Error(
      `Unable to derive runtime base image registry tag from ${SANDBOX_RUNTIME_BASE_DOCKERFILE_PATH}. Expected a FROM line for stage "${SANDBOX_RUNTIME_BASE_STAGE_NAME}".`,
    );
  }

  return runtimeBaseImageMatch[1];
}
