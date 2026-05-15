import { Sandbox } from "tensorlake";
import { it as vitestIt } from "vitest";

import {
  SandboxProvider,
  createTensorlakeRegisteredImageHandle,
  type SandboxImageHandle,
} from "../../src/index.js";
import {
  createTensorlakeAdapter,
  type TensorlakeSandboxAdapter,
} from "../../src/providers/tensorlake/index.js";
import { resolveSandboxIntegrationSettings } from "../config.js";
import { resolveTensorlakeAdapterIntegrationSettings } from "./config.js";

export type TensorlakeAdapterIntegrationFixture = {
  adapter: TensorlakeSandboxAdapter;
  baseImage: SandboxImageHandle;
  connectSandbox(id: string): Promise<Sandbox>;
  deleteSnapshot(snapshotId: string): Promise<void>;
  listSnapshotIdsForSandbox(sandboxId: string): Promise<readonly string[]>;
};

export const sandboxIntegrationSettings = resolveSandboxIntegrationSettings(process.env);

export const tensorlakeAdapterIntegrationEnabled =
  sandboxIntegrationSettings.enabled &&
  sandboxIntegrationSettings.providers.has(SandboxProvider.TENSORLAKE);

export const tensorlakeAdapterIntegrationSettings = resolveTensorlakeAdapterIntegrationSettings({
  env: process.env,
  enabled: tensorlakeAdapterIntegrationEnabled,
});

function createBaseImageHandle(): SandboxImageHandle {
  if (!tensorlakeAdapterIntegrationSettings.enabled) {
    throw new Error("Tensorlake base image requested while Tensorlake integration is disabled.");
  }
  return createTensorlakeRegisteredImageHandle(tensorlakeAdapterIntegrationSettings.baseImage);
}

export const it = vitestIt.extend<{ fixture: TensorlakeAdapterIntegrationFixture }>({
  fixture: [
    async ({}, use) => {
      const settings = tensorlakeAdapterIntegrationSettings;
      if (!settings.enabled) {
        throw new Error(
          'Tensorlake adapter integration fixture requested while tensorlake provider integration is disabled. Set MISTLE_TEST_SANDBOX_INTEGRATION=1, include "tensorlake" in MISTLE_TEST_SANDBOX_INTEGRATION_PROVIDERS, and export TENSORLAKE_API_KEY.',
        );
      }

      const adapter = createTensorlakeAdapter({ apiKey: settings.apiKey });
      await use({
        adapter,
        baseImage: createBaseImageHandle(),
        connectSandbox(id: string) {
          return Sandbox.connect({ sandboxId: id, apiKey: settings.apiKey });
        },
        async deleteSnapshot(snapshotId: string) {
          await Sandbox.deleteSnapshot(snapshotId, { apiKey: settings.apiKey });
        },
        async listSnapshotIdsForSandbox(sandboxId: string) {
          const snapshots = await Sandbox.listSnapshots({ apiKey: settings.apiKey });
          return snapshots
            .filter((snapshot) => snapshot.sandboxId === sandboxId)
            .map((snapshot) => snapshot.snapshotId);
        },
      });
    },
    { scope: "file" },
  ],
});
