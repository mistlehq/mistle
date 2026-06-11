import { createIntegrationRegistry } from "@mistle/integrations-definitions/server";
import { SandboxProvider } from "@mistle/sandbox";
import { describe, expect, it } from "vitest";

import { listSandboxProviders } from "./list-sandbox-providers.js";

describe("listSandboxProviders", () => {
  it("lists Modal as a BYOK-capable managed sandbox provider when deployment credentials are configured", () => {
    const result = listSandboxProviders({
      integrationRegistry: createIntegrationRegistry(),
      sandboxConfig: {
        defaultBaseImage: "ghcr.io/mistle/sandbox-base:latest",
        gatewayWsUrl: "wss://gateway.example.test/tunnel/sandbox",
        modal: {
          enabled: true,
          tokenId: "ak-test-token-id",
          tokenSecret: "as-test-token-secret",
          appName: "mistle-modal-sandboxes",
        },
      },
    });

    expect(result.items).toContainEqual({
      id: SandboxProvider.MODAL,
      displayName: "Modal",
      managed: true,
      supportsOrganizationConnection: true,
      resourceCapabilities: {
        vcpuCount: {
          min: 1,
          max: 8,
          step: 1,
          default: 1,
        },
        memoryMb: {
          min: 1024,
          max: 32_768,
          step: 1024,
          default: 4096,
        },
      },
    });
  });
});
