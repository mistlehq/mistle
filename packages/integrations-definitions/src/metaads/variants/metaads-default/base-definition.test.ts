import { IntegrationKinds, IntegrationMcpTransports } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { MetaAdsDefaultVariantId, MetaAdsFamilyId } from "./auth.js";
import { MetaAdsBaseDefinition } from "./base-definition.js";
import { MetaAdsMcpUrl } from "./compile-binding.js";
import { MetaAdsToolIds } from "./tool-ids.js";

type MetaAdsMcpDefinition = NonNullable<typeof MetaAdsBaseDefinition.mcp>;
type ExtractMcpInput<T> = T extends (input: infer Input) => unknown ? Input : never;
type MetaAdsMcpInput = ExtractMcpInput<MetaAdsMcpDefinition>;

const BaseInput = {
  organizationId: "org_123",
  sandboxProfileId: "sbp_123",
  version: 1,
  targetKey: "metaads-default",
  target: {
    familyId: MetaAdsFamilyId,
    variantId: MetaAdsDefaultVariantId,
    enabled: true,
    config: {
      graph_api_version: "v25.0",
    },
    secrets: {},
  },
  connection: {
    id: "icn_metaads",
    status: "active",
    config: {
      connection_method: "api-key",
    },
  },
  binding: {
    id: "ibd_123",
    kind: IntegrationKinds.CONNECTOR,
    config: {
      tools: [MetaAdsToolIds.METAADS_MCP],
    },
  },
  refs: {
    sandboxPaths: {
      userHomeDir: "/root",
      workspaceDir: "/root",
      runtimeDataDir: "/var/lib/mistle",
      runtimeArtifactDir: "/var/lib/mistle/artifacts",
      runtimeArtifactBinDir: "/usr/local/bin",
    },
    artifactBinPath(name: string): string {
      return `/usr/local/bin/${name}`;
    },
  },
} satisfies MetaAdsMcpInput;

function resolveMetaAdsMcp(input: MetaAdsMcpInput): unknown {
  const mcpDefinition = MetaAdsBaseDefinition.mcp;
  if (typeof mcpDefinition !== "function") {
    throw new Error("Expected Meta Ads MCP definition to be a function.");
  }

  return mcpDefinition(input);
}

describe("MetaAdsBaseDefinition", () => {
  it("emits the local Meta Ads MCP server only when the MCP tool is selected", () => {
    expect(resolveMetaAdsMcp(BaseInput)).toEqual([
      {
        serverId: MetaAdsToolIds.METAADS_MCP,
        serverName: "metaads",
        transport: IntegrationMcpTransports.STREAMABLE_HTTP,
        url: MetaAdsMcpUrl,
        description: "Meta Ads MCP",
      },
    ]);

    expect(
      resolveMetaAdsMcp({
        ...BaseInput,
        binding: {
          ...BaseInput.binding,
          config: {
            tools: [MetaAdsToolIds.METAADS_CLI],
          },
        },
      }),
    ).toEqual([]);
  });
});
