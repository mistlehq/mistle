import { it as vitestIt } from "vitest";

import {
  SandboxProvider,
  createFreestyleSnapshotImageHandle,
  type SandboxImageHandle,
} from "../../src/index.js";
import { FreestyleClientOperationIds } from "../../src/providers/freestyle/client-errors.js";
import { FreestyleApiClient } from "../../src/providers/freestyle/client.js";
import {
  createFreestyleAdapter,
  type FreestyleSandboxAdapter,
} from "../../src/providers/freestyle/index.js";
import { resolveSandboxIntegrationSettings } from "../config.js";
import { resolveFreestyleAdapterIntegrationSettings } from "./config.js";

const FreestyleDefaultBaseUrl = "https://api.freestyle.sh";

export type FreestyleAdapterIntegrationFixture = {
  adapter: FreestyleSandboxAdapter;
  baseImage: SandboxImageHandle;
  client: FreestyleApiClient;
  deleteSnapshot(snapshotId: string): Promise<void>;
  readFile(input: { vmId: string; path: string }): Promise<string>;
  writeFile(input: { vmId: string; path: string; contents: string }): Promise<void>;
};

export const sandboxIntegrationSettings = resolveSandboxIntegrationSettings(process.env);

export const freestyleAdapterIntegrationEnabled =
  sandboxIntegrationSettings.enabled &&
  sandboxIntegrationSettings.providers.has(SandboxProvider.FREESTYLE);

export const freestyleAdapterIntegrationSettings = resolveFreestyleAdapterIntegrationSettings({
  env: process.env,
  enabled: freestyleAdapterIntegrationEnabled,
});

function createClientConfig(): {
  apiKey: string;
  baseUrl?: string;
} {
  if (!freestyleAdapterIntegrationSettings.enabled) {
    throw new Error(
      "Freestyle integration settings requested while Freestyle integration is disabled.",
    );
  }

  return {
    apiKey: freestyleAdapterIntegrationSettings.apiKey,
    ...(freestyleAdapterIntegrationSettings.baseUrl === undefined
      ? {}
      : { baseUrl: freestyleAdapterIntegrationSettings.baseUrl }),
  };
}

function createBaseImageHandle(): SandboxImageHandle {
  if (!freestyleAdapterIntegrationSettings.enabled) {
    throw new Error("Freestyle base image requested while Freestyle integration is disabled.");
  }

  return createFreestyleSnapshotImageHandle(freestyleAdapterIntegrationSettings.baseImage);
}

export const it = vitestIt.extend<{ fixture: FreestyleAdapterIntegrationFixture }>({
  fixture: [
    async ({}, use) => {
      const settings = freestyleAdapterIntegrationSettings;
      if (!settings.enabled) {
        throw new Error(
          'Freestyle adapter integration fixture requested while freestyle provider integration is disabled. Set MISTLE_TEST_SANDBOX_INTEGRATION=1, include "freestyle" in MISTLE_TEST_SANDBOX_INTEGRATION_PROVIDERS, and export FREESTYLE_API_KEY.',
        );
      }

      const config = createClientConfig();
      const adapter = createFreestyleAdapter(config);
      const client = new FreestyleApiClient(config);

      await use({
        adapter,
        baseImage: createBaseImageHandle(),
        client,
        async deleteSnapshot(snapshotId: string) {
          await deleteFreestyleSnapshot({
            apiKey: settings.apiKey,
            baseUrl: settings.baseUrl ?? FreestyleDefaultBaseUrl,
            snapshotId,
          });
        },
        async readFile(input: { vmId: string; path: string }) {
          const result = await client.runCommand({
            vmId: input.vmId,
            operation: FreestyleClientOperationIds.RUN_COMMAND,
            commandDescription: `Read ${input.path}`,
            command: `cat ${shellQuote(input.path)}`,
          });
          return result.stdout;
        },
        async writeFile(input: { vmId: string; path: string; contents: string }) {
          await client.writeFile({
            vmId: input.vmId,
            path: input.path,
            content: new TextEncoder().encode(input.contents),
          });
        },
      });
    },
    { scope: "file" },
  ],
});

async function deleteFreestyleSnapshot(input: {
  apiKey: string;
  baseUrl: string;
  snapshotId: string;
}): Promise<void> {
  const response = await fetch(
    new URL(`/v1/vms/snapshots/${encodeURIComponent(input.snapshotId)}`, input.baseUrl),
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
      },
    },
  );

  if (!response.ok && response.status !== 404) {
    throw new Error(
      `Freestyle snapshot delete failed with status ${String(response.status)}: ${await response.text()}`,
    );
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
