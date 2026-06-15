import { describe, expect, it } from "vitest";

import { InceptionDefinition } from "./definition.js";
import { InceptionTargetConfigSchema } from "./target-config-schema.js";

describe("InceptionDefinition", () => {
  it("compiles Inception Labs API key access into a provider-owned egress route", () => {
    const targetConfig = InceptionTargetConfigSchema.parse({});

    expect(
      InceptionDefinition.compileBinding({
        organizationId: "org_123",
        sandboxProfileId: "sbp_123",
        version: 1,
        targetKey: "inception-default",
        target: {
          familyId: "inception",
          variantId: "inception-default",
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
          hosts: ["api.inceptionlabs.ai"],
          pathPrefixes: ["/v1"],
          methods: ["GET", "POST"],
        },
        upstream: {
          baseUrl: "https://api.inceptionlabs.ai/v1",
        },
        authInjection: {
          type: "bearer",
          target: "authorization",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_123",
          secretType: "api_key",
          slotKey: "inception.inception-default.api-key.api-key",
        },
      },
    ]);
  });
});
