import { describe, expect, it } from "vitest";

import { FireworksDefinition } from "./definition.js";
import { FireworksTargetConfigSchema } from "./target-config-schema.js";

describe("FireworksDefinition", () => {
  it("compiles Fireworks AI API key access into a provider-owned egress route", () => {
    const targetConfig = FireworksTargetConfigSchema.parse({});

    expect(
      FireworksDefinition.compileBinding({
        organizationId: "org_123",
        sandboxProfileId: "sbp_123",
        version: 1,
        targetKey: "fireworks-default",
        target: {
          familyId: "fireworks",
          variantId: "fireworks-default",
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
          hosts: ["api.fireworks.ai"],
          pathPrefixes: ["/inference/v1"],
          methods: ["GET", "POST"],
        },
        upstream: {
          baseUrl: "https://api.fireworks.ai/inference/v1",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_123",
          secretType: "api_key",
          slotKey: "fireworks.fireworks-default.api-key.api-key",
        },
      },
    ]);
  });
});
