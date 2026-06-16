import { IntegrationKinds, IntegrationMcpTransports } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { ResendMcpBaseDefinition } from "./base-definition.js";
import { ResendConnectionConfigForm } from "./binding-config-form.js";
import { type ResendCompileBindingInput, ResendMcpWrapperPath } from "./compile-binding.js";
import { ResendToolIds } from "./tool-ids.js";

function resolveResendMcp(input: ResendCompileBindingInput): unknown {
  const mcpDefinition = ResendMcpBaseDefinition.mcp;
  if (typeof mcpDefinition !== "function") {
    throw new Error("Expected Resend MCP definition to be a function.");
  }

  return mcpDefinition(input);
}

const BaseInput = {
  organizationId: "org_123",
  sandboxProfileId: "sbp_123",
  version: 1,
  targetKey: "resend-mcp",
  target: {
    familyId: "resend",
    variantId: "resend-mcp",
    enabled: true,
    config: {},
    secrets: {},
  },
  connection: {
    id: "icn_resend",
    status: "active",
    config: {
      connection_method: "api-key",
    },
  },
  binding: {
    id: "ibd_123",
    kind: IntegrationKinds.CONNECTOR,
    config: {
      tools: [ResendToolIds.RESEND_MCP],
      replyToEmailAddresses: [],
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
} satisfies ResendCompileBindingInput;

describe("ResendMcpBaseDefinition", () => {
  it("emits the resend provider mcp server only when the tool is selected", () => {
    expect(resolveResendMcp(BaseInput)).toEqual([
      {
        serverId: ResendToolIds.RESEND_MCP,
        serverName: "resend",
        transport: IntegrationMcpTransports.STDIO,
        command: ResendMcpWrapperPath,
        description: "Resend MCP tools backed by the Resend connection.",
      },
    ]);
    expect(
      resolveResendMcp({
        ...BaseInput,
        binding: {
          ...BaseInput.binding,
          config: {
            ...BaseInput.binding.config,
            tools: [],
          },
        },
      }),
    ).toEqual([]);
  });

  it("explains the API key permission boundary", () => {
    const apiKeyMethod = ResendMcpBaseDefinition.connectionMethods.find(
      (method) => method.id === "api-key",
    );

    expect(apiKeyMethod).toMatchObject({
      kind: "form",
      secretFields: [
        {
          name: "apiKey",
          description: expect.stringContaining("Prefer a sending_access key"),
        },
      ],
    });
    expect(apiKeyMethod?.configForm).toBe(ResendConnectionConfigForm);
  });
});
