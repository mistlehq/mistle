import { IntegrationKinds } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { resolveAwsBindingConfigForm } from "./binding-config-form.js";
import { AwsToolIds } from "./tool-ids.js";

describe("resolveAwsBindingConfigForm", () => {
  it("keeps AWS scope fields free of redundant helper text", () => {
    const form = resolveAwsBindingConfigForm({
      currentValue: {},
      familyId: "aws",
      kind: IntegrationKinds.CONNECTOR,
      variantId: "aws-cli-default",
    });

    expect(form.schema).toMatchObject({
      properties: {
        services: {},
        regions: {},
      },
    });
    expect(JSON.stringify(form.schema)).not.toContain("Allowed AWS");
    expect(JSON.stringify(form.uiSchema)).not.toContain("ui:help");
    expect(JSON.stringify(form.uiSchema)).not.toContain("Allowed AWS");
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
