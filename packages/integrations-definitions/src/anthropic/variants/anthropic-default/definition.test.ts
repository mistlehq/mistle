import { describe, expect, it } from "vitest";

import { AnthropicDefinition } from "./definition.js";
import { AnthropicTargetConfigSchema } from "./target-config-schema.js";

describe("AnthropicDefinition", () => {
  it("compiles Anthropic API key access into a provider-owned egress route", () => {
    const targetConfig = AnthropicTargetConfigSchema.parse({});

    expect(
      AnthropicDefinition.compileBinding({
        organizationId: "org_123",
        sandboxProfileId: "sbp_123",
        version: 1,
        targetKey: "anthropic-default",
        target: {
          familyId: "anthropic",
          variantId: "anthropic-default",
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
          hosts: ["api.anthropic.com"],
          pathPrefixes: ["/v1"],
          methods: ["GET", "POST"],
        },
        upstream: {
          baseUrl: "https://api.anthropic.com",
        },
        authInjection: {
          type: "header",
          target: "x-api-key",
        },
        credentialResolver: {
          kind: "integration_connection",
          connectionId: "icn_123",
          secretType: "api_key",
          slotKey: "anthropic.anthropic-default.api-key.api-key",
        },
      },
    ]);
  });
});
