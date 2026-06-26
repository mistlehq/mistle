import { createIntegrationRegistry } from "@mistle/integrations-definitions/server";
import { SandboxProvider } from "@mistle/sandbox";
import { describe, expect, it } from "vitest";

import {
  createDefaultProfileVersionRuntimeConfig,
  createWorkflowSandboxRuntime,
} from "./profile-version-runtime-config.js";

const integrationRegistry = createIntegrationRegistry();

describe("profile version runtime config", () => {
  it("defaults new profile versions to the configured Mistle managed provider", () => {
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
      sandboxProvider: SandboxProvider.TENSORLAKE,
      sandboxConnectionId: null,
      sandboxVcpuCount: 2,
      sandboxMemoryMb: 8192,
      sandboxDiskMb: 10240,
    });
  });

  it("keeps new profile versions unconfigured when no managed provider is available", () => {
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

  it("creates Modal workflow runtime input", () => {
    expect(
      createWorkflowSandboxRuntime({
        sandboxProvider: SandboxProvider.MODAL,
        sandboxConnectionId: null,
        sandboxResources: {
          vcpuCount: 2,
          memoryMb: 4096,
        },
      }),
    ).toEqual({
      provider: SandboxProvider.MODAL,
      resources: {
        vcpuCount: 2,
        memoryMb: 4096,
      },
    });
  });
});
