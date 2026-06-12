import { IntegrationKinds, IntegrationMcpTransports } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { AwsConnectionMethodIds } from "./auth.js";
import { AwsBaseDefinition } from "./base-definition.js";
import { AwsCloudWatchMcpWrapperPath, type AwsCompileBindingInput } from "./compile-binding.js";
import { AwsToolIds } from "./tool-ids.js";

function resolveAwsMcp(input: AwsCompileBindingInput): unknown {
  const mcpDefinition = AwsBaseDefinition.mcp;
  if (typeof mcpDefinition !== "function") {
    throw new Error("Expected AWS MCP definition to be a function.");
  }

  return mcpDefinition(input);
}

describe("AwsBaseDefinition", () => {
  it("emits the cloudwatch provider mcp server only when the tool is selected", () => {
    const input: AwsCompileBindingInput = {
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      version: 1,
      targetKey: "aws-cli-default",
      target: {
        familyId: "aws",
        variantId: "aws-cli-default",
        enabled: true,
        config: {},
        secrets: {},
      },
      connection: {
        id: "icn_aws",
        status: "active",
        config: {
          connection_method: AwsConnectionMethodIds.AWS_ASSUME_ROLE,
          accessKeyId: "AKIAEXAMPLE",
          roleArn: "arn:aws:iam::123456789012:role/mistle-dev",
        },
      },
      binding: {
        id: "ibd_123",
        kind: IntegrationKinds.CONNECTOR,
        config: {
          services: ["cloudwatch"],
          regions: ["us-east-1"],
          defaultRegion: "us-east-1",
          tools: [AwsToolIds.AWS_CLOUDWATCH_MCP],
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
    };

    expect(resolveAwsMcp(input)).toEqual([
      {
        serverId: AwsToolIds.AWS_CLOUDWATCH_MCP,
        serverName: "aws_cloudwatch",
        transport: IntegrationMcpTransports.STDIO,
        command: AwsCloudWatchMcpWrapperPath,
        description: "CloudWatch and CloudWatch Logs MCP tools backed by the AWS connection.",
      },
    ]);
    expect(
      resolveAwsMcp({
        ...input,
        binding: {
          ...input.binding,
          config: {
            ...input.binding.config,
            tools: [AwsToolIds.AWS_CLI],
          },
        },
      }),
    ).toEqual([]);
  });

  it("explains the secret access key used by the assume-role connection method", () => {
    const assumeRoleMethod = AwsBaseDefinition.connectionMethods.find(
      (method) => method.id === AwsConnectionMethodIds.AWS_ASSUME_ROLE,
    );

    expect(assumeRoleMethod).toMatchObject({
      kind: "form",
      secretFields: [
        {
          name: "secretAccessKey",
          description: expect.stringContaining("temporary role credentials"),
        },
      ],
    });
  });
});
