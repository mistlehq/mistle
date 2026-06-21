import { IntegrationKinds, IntegrationMcpTransports } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { WhapiMcpBaseDefinition } from "./base-definition.js";
import { WhapiConnectionConfigForm } from "./binding-config-form.js";
import { type WhapiCompileBindingInput, WhapiMcpWrapperPath } from "./compile-binding.js";
import { WhapiToolIds } from "./tool-ids.js";

function resolveWhapiMcp(input: WhapiCompileBindingInput): unknown {
  const mcpDefinition = WhapiMcpBaseDefinition.mcp;
  if (typeof mcpDefinition !== "function") {
    throw new Error("Expected Whapi MCP definition to be a function.");
  }

  return mcpDefinition(input);
}

const BaseInput = {
  organizationId: "org_123",
  sandboxProfileId: "sbp_123",
  version: 1,
  targetKey: "whapi-mcp",
  target: {
    familyId: "whapi",
    variantId: "whapi-mcp",
    enabled: true,
    config: {},
    secrets: {},
  },
  connection: {
    id: "icn_whapi",
    status: "active",
    config: {
      connection_method: "api-key",
    },
  },
  binding: {
    id: "ibd_123",
    kind: IntegrationKinds.CONNECTOR,
    config: {
      tools: [WhapiToolIds.WHAPI_MCP],
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
} satisfies WhapiCompileBindingInput;

describe("WhapiMcpBaseDefinition", () => {
  it("emits the whapi provider mcp server only when the tool is selected", () => {
    expect(resolveWhapiMcp(BaseInput)).toEqual([
      {
        serverId: WhapiToolIds.WHAPI_MCP,
        serverName: "whapi",
        transport: IntegrationMcpTransports.STDIO,
        command: WhapiMcpWrapperPath,
        description: "Whapi MCP tools backed by the Whapi connection.",
      },
    ]);
    expect(
      resolveWhapiMcp({
        ...BaseInput,
        binding: {
          ...BaseInput.binding,
          config: {
            tools: [],
          },
        },
      }),
    ).toEqual([]);
  });

  it("explains the API token and webhook secret boundaries", () => {
    const apiKeyMethod = WhapiMcpBaseDefinition.connectionMethods.find(
      (method) => method.id === "api-key",
    );

    expect(apiKeyMethod).toMatchObject({
      kind: "form",
      createBehavior: "draft-then-setup",
      setupFlow: {
        completionRequirements: {
          kind: "all-of",
          allOf: [
            {
              kind: "secret-field",
              field: "apiToken",
            },
            {
              kind: "secret-field",
              field: "webhookSecret",
            },
          ],
        },
        providerConfigurationSetup: {
          webhookCallback: {
            label: "Webhook URL",
          },
          instructions: {
            items: expect.arrayContaining([expect.stringContaining("x-whapi-webhook-secret")]),
          },
          fields: {
            secretFields: expect.arrayContaining([
              expect.objectContaining({
                name: "webhookSecret",
                description: expect.stringContaining("x-whapi-webhook-secret"),
                generation: {
                  kind: "random-token",
                },
                inputType: "text",
              }),
            ]),
          },
        },
        routeSegment: "provider-configuration",
        setupPane: {
          kind: "provider-configuration",
        },
      },
      secretFields: [
        {
          name: "apiToken",
          description: expect.stringContaining("managed egress"),
        },
        {
          name: "webhookSecret",
          description: expect.stringContaining("x-whapi-webhook-secret"),
        },
      ],
    });
    expect(apiKeyMethod?.configForm).toBe(WhapiConnectionConfigForm);
  });
});
