import { IntegrationKinds } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { resolveAwsBindingConfigForm } from "./binding-config-form.js";
import { AwsToolIds } from "./tool-ids.js";

describe("resolveAwsBindingConfigForm", () => {
  it("explains how AWS scope fields affect sandbox access", () => {
    const form = resolveAwsBindingConfigForm({
      currentValue: {},
      familyId: "aws",
      kind: IntegrationKinds.CONNECTOR,
      variantId: "aws-cli-default",
    });

    expect(form.schema).toMatchObject({
      properties: {
        services: {
          description: expect.stringContaining("managed egress"),
        },
        regions: {
          description: expect.stringContaining("regions"),
        },
        defaultRegion: {
          description: expect.stringContaining("does not specify one"),
        },
      },
    });
    expect(JSON.stringify(form.uiSchema)).not.toContain("ui:help");
  });

  it("keeps aws cli as the only default tool while offering cloudwatch mcp", () => {
    const form = resolveAwsBindingConfigForm({
      currentValue: {},
      familyId: "aws",
      kind: IntegrationKinds.CONNECTOR,
      variantId: "aws-cli-default",
    });

    expect(form.schema).toMatchObject({
      properties: {
        tools: {
          default: [AwsToolIds.AWS_CLI],
          description: expect.stringContaining("CloudWatch and Logs MCP tools"),
          items: {
            enum: [AwsToolIds.AWS_CLI, AwsToolIds.AWS_CLOUDWATCH_MCP],
          },
        },
      },
    });
    expect(form.uiSchema).toMatchObject({
      tools: {
        "ui:enumNames": ["AWS CLI", "CloudWatch MCP"],
      },
    });
  });
});
