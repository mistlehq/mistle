import { describe, expect, it } from "vitest";

import { OpenRouterDefinition } from "./definition.js";
import { OpenRouterTargetConfigSchema } from "./target-config-schema.js";

describe("OpenRouterDefinition", () => {
  it("compiles OpenRouter API key access into a provider-owned egress route", () => {
    const targetConfig = OpenRouterTargetConfigSchema.parse({});

    expect(
      OpenRouterDefinition.compileBinding({
        organizationId: "org_123",
        sandboxProfileId: "sbp_123",
        version: 1,
        targetKey: "openrouter-default",
        target: {
          familyId: "openrouter",
          variantId: "openrouter-default",
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
          hosts: ["openrouter.ai"],
          pathPrefixes: ["/api/v1"],
          methods: ["GET", "POST"],
        },
        upstream: {
          baseUrl: "https://openrouter.ai/api/v1",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_123",
          secretType: "api_key",
          slotKey: "openrouter.openrouter-default.api-key.api-key",
        },
      },
    ]);
  });
});
