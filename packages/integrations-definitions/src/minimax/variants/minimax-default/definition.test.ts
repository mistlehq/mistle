import { describe, expect, it } from "vitest";

import { MiniMaxDefinition } from "./definition.js";
import { MiniMaxTargetConfigSchema } from "./target-config-schema.js";

describe("MiniMaxDefinition", () => {
  it("compiles MiniMax API key access into provider-owned Pi and OpenCode egress routes", () => {
    const targetConfig = MiniMaxTargetConfigSchema.parse({});

    expect(
      MiniMaxDefinition.compileBinding({
        organizationId: "org_123",
        sandboxProfileId: "sbp_123",
        version: 1,
        targetKey: "minimax-default",
        target: {
          familyId: "minimax",
          variantId: "minimax-default",
          enabled: true,
          config: targetConfig,
          secrets: {},
        },
        connection: {
          id: "icn_123",
          status: "active",
          config: {
            connection_method: "api-key",
          },
        },
        binding: {
          id: "ibd_123",
          kind: "agent",
          config: {},
        },
        refs: {
          sandboxPaths: {
            userHomeDir: "/sandbox/home",
            workspaceDir: "/sandbox/home",
            runtimeDataDir: "/sandbox/runtime-data",
            runtimeArtifactDir: "/sandbox/runtime-artifacts",
            runtimeArtifactBinDir: "/sandbox/runtime-artifacts/bin",
          },
          artifactBinPath: (name) => `/sandbox/runtime-artifacts/bin/${name}`,
        },
      }).egressRoutes,
    ).toEqual([
      {
        match: {
          hosts: ["api.minimaxi.com"],
          pathPrefixes: ["/v1"],
          methods: ["GET", "POST"],
        },
        upstream: {
          baseUrl: "https://api.minimaxi.com/v1",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_123",
          secretType: "api_key",
          slotKey: "minimax.minimax-default.api-key.api-key",
        },
      },
      {
        match: {
          hosts: ["api.minimaxi.com"],
          pathPrefixes: ["/anthropic/v1"],
          methods: ["GET", "POST"],
        },
        upstream: {
          baseUrl: "https://api.minimaxi.com/anthropic/v1",
        },
        authInjection: {
          type: "header",
          target: "x-api-key",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_123",
          secretType: "api_key",
          slotKey: "minimax.minimax-default.api-key.api-key",
        },
      },
    ]);
  });
});
