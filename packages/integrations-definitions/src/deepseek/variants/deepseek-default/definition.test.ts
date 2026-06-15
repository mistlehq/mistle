import { describe, expect, it } from "vitest";

import { DeepSeekDefinition } from "./definition.js";
import { DeepSeekTargetConfigSchema } from "./target-config-schema.js";

describe("DeepSeekDefinition", () => {
  it("compiles DeepSeek API key access into a provider-owned egress route", () => {
    const targetConfig = DeepSeekTargetConfigSchema.parse({});

    expect(
      DeepSeekDefinition.compileBinding({
        organizationId: "org_123",
        sandboxProfileId: "sbp_123",
        version: 1,
        targetKey: "deepseek-default",
        target: {
          familyId: "deepseek",
          variantId: "deepseek-default",
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
          hosts: ["api.deepseek.com"],
          pathPrefixes: ["/"],
          methods: ["GET", "POST"],
        },
        upstream: {
          baseUrl: "https://api.deepseek.com",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_123",
          secretType: "api_key",
          slotKey: "deepseek.deepseek-default.api-key.api-key",
        },
      },
    ]);
  });
});
