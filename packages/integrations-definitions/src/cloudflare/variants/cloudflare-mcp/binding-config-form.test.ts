import { resolveIntegrationForm } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { CloudflareConnectionConfigSchema } from "./auth.js";
import {
  CloudflareConnectionConfigForm,
  resolveCloudflareBindingConfigForm,
} from "./binding-config-form.js";
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

  it("hides the single API token connection method while defaulting it in config", () => {
    const resolvedForm = resolveIntegrationForm({
      schema: CloudflareConnectionConfigSchema,
      form: CloudflareConnectionConfigForm,
      context: {
        familyId: "cloudflare",
        variantId: "cloudflare-mcp",
        kind: "connector",
      },
    });

    expect(resolvedForm.schema).toMatchObject({
      properties: {
        connection_method: {
          default: "api-key",
        },
      },
    });
    expect(resolvedForm.uiSchema).toEqual({
      connection_method: {
        "ui:widget": "hidden",
      },
    });
  });
});
