import { describe, expect, it } from "vitest";

import { KimiDefinition } from "./definition.js";
import { KimiTargetConfigSchema } from "./target-config-schema.js";

describe("KimiDefinition", () => {
  it("compiles Kimi API key access into a provider-owned egress route", () => {
    const targetConfig = KimiTargetConfigSchema.parse({});

    expect(
      KimiDefinition.compileBinding({
        organizationId: "org_123",
        sandboxProfileId: "sbp_123",
        version: 1,
        targetKey: "kimi-default",
        target: {
          familyId: "kimi",
          variantId: "kimi-default",
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
          hosts: ["api.moonshot.ai"],
          pathPrefixes: ["/v1"],
          methods: ["GET", "POST"],
        },
        upstream: {
          baseUrl: "https://api.moonshot.ai/v1",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_123",
          secretType: "api_key",
          slotKey: "kimi.kimi-default.api-key.api-key",
        },
      },
    ]);
  });
});
