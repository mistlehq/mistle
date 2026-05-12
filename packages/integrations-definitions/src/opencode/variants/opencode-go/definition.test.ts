import { describe, expect, it } from "vitest";

import { OpenCodeGoDefinition } from "./definition.js";
import { OpenCodeGoTargetConfigSchema } from "./target-config-schema.js";

describe("OpenCodeGoDefinition", () => {
  it("compiles OpenCode Go API key access into a provider-owned egress route", () => {
    const targetConfig = OpenCodeGoTargetConfigSchema.parse({});

    expect(
      OpenCodeGoDefinition.compileBinding({
        organizationId: "org_123",
        sandboxProfileId: "sbp_123",
        version: 1,
        targetKey: "opencode-go",
        target: {
          familyId: "opencode",
          variantId: "opencode-go",
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
          hosts: ["opencode.ai"],
          pathPrefixes: ["/zen/go/v1"],
          methods: ["GET", "POST"],
        },
        upstream: {
          baseUrl: "https://opencode.ai/zen/go/v1",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_123",
          secretType: "api_key",
          slotKey: "opencode.opencode-go.api-key.api-key",
        },
      },
    ]);
  });
});
