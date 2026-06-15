import { describe, expect, it } from "vitest";

import { ZaiDefinition } from "./definition.js";
import { ZaiTargetConfigSchema } from "./target-config-schema.js";

describe("ZaiDefinition", () => {
  it("compiles Zai API key access into a provider-owned egress route", () => {
    const targetConfig = ZaiTargetConfigSchema.parse({});

    expect(
      ZaiDefinition.compileBinding({
        organizationId: "org_123",
        sandboxProfileId: "sbp_123",
        version: 1,
        targetKey: "zai-coding-plan",
        target: {
          familyId: "zai",
          variantId: "zai-coding-plan",
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
          hosts: ["api.z.ai"],
          pathPrefixes: ["/api/coding/paas/v4"],
          methods: ["GET", "POST"],
        },
        upstream: {
          baseUrl: "https://api.z.ai/api/coding/paas/v4",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_123",
          secretType: "api_key",
          slotKey: "zai.zai-coding-plan.api-key.api-key",
        },
      },
    ]);
  });
});
