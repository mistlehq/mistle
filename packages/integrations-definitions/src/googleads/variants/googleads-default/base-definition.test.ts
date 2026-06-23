import { IntegrationKinds, IntegrationMcpTransports } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { GoogleAdsDefaultVariantId, GoogleAdsFamilyId } from "./auth.js";
import { GoogleAdsBaseDefinition } from "./base-definition.js";
import { GoogleAdsMcpUrl } from "./compile-binding.js";
import { GoogleAdsToolIds } from "./tool-ids.js";

type GoogleAdsMcpDefinition = NonNullable<typeof GoogleAdsBaseDefinition.mcp>;
type ExtractMcpInput<T> = T extends (input: infer Input) => unknown ? Input : never;
type GoogleAdsMcpInput = ExtractMcpInput<GoogleAdsMcpDefinition>;

const BaseInput = {
  organizationId: "org_123",
  sandboxProfileId: "sbp_123",
  version: 1,
  targetKey: "googleads-default",
  target: {
    familyId: GoogleAdsFamilyId,
    variantId: GoogleAdsDefaultVariantId,
    enabled: true,
    config: {
      api_version: "v24",
    },
    secrets: {},
  },
  connection: {
    id: "icn_googleads",
    status: "active",
    config: {
      connection_method: "oauth2-authorization-code",
      client_id: "google_client_123.apps.googleusercontent.com",
    },
  },
  binding: {
    id: "ibd_123",
    kind: IntegrationKinds.CONNECTOR,
    config: {
      tools: [GoogleAdsToolIds.GOOGLEADS_MCP],
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
} satisfies GoogleAdsMcpInput;

function resolveGoogleAdsMcp(input: GoogleAdsMcpInput): unknown {
  const mcpDefinition = GoogleAdsBaseDefinition.mcp;
  if (typeof mcpDefinition !== "function") {
    throw new Error("Expected Google Ads MCP definition to be a function.");
  }

  return mcpDefinition(input);
}

describe("GoogleAdsBaseDefinition", () => {
  it("emits the local Google Ads MCP server only when the MCP tool is selected", () => {
    expect(resolveGoogleAdsMcp(BaseInput)).toEqual([
      {
        serverId: GoogleAdsToolIds.GOOGLEADS_MCP,
        serverName: "googleads",
        transport: IntegrationMcpTransports.STREAMABLE_HTTP,
        url: GoogleAdsMcpUrl,
        description: "Google Ads MCP",
      },
    ]);

    expect(
      resolveGoogleAdsMcp({
        ...BaseInput,
        binding: {
          ...BaseInput.binding,
          config: {
            tools: [GoogleAdsToolIds.GOOGLEADS_CLI],
          },
        },
      }),
    ).toEqual([]);
  });
});
