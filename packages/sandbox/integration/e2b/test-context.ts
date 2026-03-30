import { Sandbox, type ConnectionOpts } from "e2b";
import { it as vitestIt } from "vitest";

import { SandboxProvider, type SandboxImageHandle } from "../../src/index.js";
import { createE2BAdapter, type E2BSandboxAdapter } from "../../src/providers/e2b/index.js";
import { E2BApiTemplateRegistry } from "../../src/providers/e2b/template-registry.js";
import { resolveSandboxIntegrationSettings } from "../config.js";
import { resolveE2BAdapterIntegrationSettings } from "./config.js";

export type E2BAdapterIntegrationFixture = {
  adapter: E2BSandboxAdapter;
  baseImage: SandboxImageHandle;
  createTemplateRegistry(): E2BApiTemplateRegistry;
  connectSandbox(id: string): Promise<Sandbox>;
};

export const sandboxIntegrationSettings = resolveSandboxIntegrationSettings(process.env);

export const e2bAdapterIntegrationEnabled =
  sandboxIntegrationSettings.enabled &&
  sandboxIntegrationSettings.providers.has(SandboxProvider.E2B);

export const e2bAdapterIntegrationSettings = resolveE2BAdapterIntegrationSettings({
  env: process.env,
  enabled: e2bAdapterIntegrationEnabled,
});

function createConnectionOptions(): ConnectionOpts {
  if (!e2bAdapterIntegrationSettings.enabled) {
    throw new Error("E2B integration settings requested while E2B integration is disabled.");
  }

  return {
    apiKey: e2bAdapterIntegrationSettings.apiKey,
    ...(e2bAdapterIntegrationSettings.domain === undefined
      ? {}
      : { domain: e2bAdapterIntegrationSettings.domain }),
  };
}

function createBaseImageHandle(): SandboxImageHandle {
  if (!e2bAdapterIntegrationSettings.enabled) {
    throw new Error("E2B base image requested while E2B integration is disabled.");
  }

  return {
    provider: SandboxProvider.E2B,
    imageId: e2bAdapterIntegrationSettings.baseImage,
    createdAt: new Date().toISOString(),
  };
}

export const it = vitestIt.extend<{ fixture: E2BAdapterIntegrationFixture }>({
  fixture: [
    async ({}, use) => {
      const settings = e2bAdapterIntegrationSettings;
      if (!settings.enabled) {
        throw new Error(
          'E2B adapter integration fixture requested while e2b provider integration is disabled. Set MISTLE_TEST_SANDBOX_INTEGRATION=1, include "e2b" in MISTLE_TEST_SANDBOX_INTEGRATION_PROVIDERS, and export E2B_API_KEY.',
        );
      }

      const adapter = createE2BAdapter({
        apiKey: settings.apiKey,
        ...(settings.domain === undefined ? {} : { domain: settings.domain }),
      });
      await use({
        adapter,
        baseImage: createBaseImageHandle(),
        createTemplateRegistry() {
          return new E2BApiTemplateRegistry(createConnectionOptions());
        },
        connectSandbox(id: string) {
          return Sandbox.connect(id, createConnectionOptions());
        },
      });
    },
    {
      scope: "file",
    },
  ],
});
