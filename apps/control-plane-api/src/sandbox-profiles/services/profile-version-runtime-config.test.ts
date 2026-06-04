import { createIntegrationRegistry } from "@mistle/integrations-definitions/server";
import { SandboxProvider } from "@mistle/sandbox";
import { describe, expect, it } from "vitest";

import {
  createDefaultProfileVersionRuntimeConfig,
  createWorkflowSandboxRuntime,
} from "./profile-version-runtime-config.js";

const integrationRegistry = createIntegrationRegistry();

describe("profile version runtime config", () => {
  it("creates an empty default runtime config for new profile versions", () => {
    expect(
      createDefaultProfileVersionRuntimeConfig({
        integrationRegistry,
        sandboxConfig: {
          defaultBaseImage: "tensorlake:image:mistle-base",
          gatewayWsUrl: "wss://gateway.example.com/tunnel/sandbox",
          bootstrap: {
            tokenSecret: "bootstrap-secret",
            tokenIssuer: "data-plane-worker",
            tokenAudience: "data-plane-gateway",
          },
          tensorlake: {
            enabled: true,
            apiKey: "tensorlake-api-key",
          },
        },
      }),
    ).toEqual({
      sandboxProvider: null,
      sandboxConnectionId: null,
      sandboxVcpuCount: null,
      sandboxMemoryMb: null,
      sandboxDiskMb: null,
    });
  });

  it("creates Tensorlake workflow runtime input", () => {
    expect(
      createWorkflowSandboxRuntime({
        sandboxProvider: SandboxProvider.TENSORLAKE,
        sandboxConnectionId: null,
        sandboxResources: {
          vcpuCount: 2,
          memoryMb: 4096,
          diskMb: 20480,
        },
      }),
    ).toEqual({
      provider: SandboxProvider.TENSORLAKE,
      resources: {
        vcpuCount: 2,
        memoryMb: 4096,
        diskMb: 20480,
      },
    });
  });
});
