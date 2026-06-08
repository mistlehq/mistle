import { resolveIntegrationForm } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { resolveCloudflareBindingConfigForm } from "./binding-config-form.js";
import { CloudflareBindingConfigSchema } from "./binding-config-schema.js";
import { CloudflareMcpServerIds } from "./mcp-catalog.js";

describe("resolveCloudflareBindingConfigForm", () => {
  it("renders Cloudflare API MCP as the default selectable server", () => {
    const resolvedForm = resolveIntegrationForm({
      schema: CloudflareBindingConfigSchema,
      form: resolveCloudflareBindingConfigForm,
      context: {
        familyId: "cloudflare",
        variantId: "cloudflare-mcp",
        kind: "connector",
      },
    });

    expect(resolvedForm.schema).toMatchObject({
      properties: {
        mcpServers: {
          title: "Cloudflare MCP servers",
          default: [CloudflareMcpServerIds.CLOUDFLARE_API],
          items: {
            type: "string",
            enum: [CloudflareMcpServerIds.CLOUDFLARE_API],
          },
          type: "array",
          uniqueItems: true,
        },
      },
    });
    expect(resolvedForm.uiSchema).toEqual({
      mcpServers: {
        "ui:enumNames": ["Cloudflare API MCP"],
        "ui:widget": "checkboxes",
        "ui:options": {
          inline: false,
          emptyMessage: "No matching remote MCP servers.",
        },
      },
    });
  });
});
