/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { mintMcpToken } from "@mistle/gateway-tunnel-auth";
import { MistleSupportedCapabilityKinds } from "@mistle/integrations-definitions/server";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";
import { z } from "zod";

import { OrganizationPermissions } from "../src/auth/services/organization-policy.js";
import { createApiKeyToken } from "./helpers/api-keys.js";
import { callMcpTool } from "./helpers/mcp-json-rpc.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

const McpTokenConfig = {
  tokenSecret: "integration-new-mcp-auth-secret",
  tokenIssuer: "integration-new-control-plane-api",
  tokenAudience: "integration-new-mistle-mcp",
};

const SupportedCapabilitiesResultSchema = z
  .object({
    items: z.array(
      z
        .object({
          familyId: z.string().min(1),
          variantId: z.string().min(1),
          displayName: z.string().min(1),
          capabilities: z
            .object({
              runtimeTools: z
                .object({
                  mcpSupported: z.boolean(),
                })
                .strict(),
              triggerEvents: z
                .object({
                  eventCount: z.number().int().min(0),
                  events: z
                    .array(
                      z
                        .object({
                          eventType: z.string().min(1),
                          displayName: z.string().min(1),
                        })
                        .loose(),
                    )
                    .optional(),
                })
                .strict(),
              providerResources: z
                .object({
                  resourceKindCount: z.number().int().min(0),
                  resources: z
                    .array(
                      z
                        .object({
                          kind: z.string().min(1),
                        })
                        .loose(),
                    )
                    .optional(),
                })
                .loose(),
            })
            .loose(),
        })
        .loose(),
    ),
  })
  .strict();

describe.concurrent("MCP capability tools integration", () => {
  it("lists supported capabilities without seeded integration connections", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-mcp-capabilities-list@example.com",
    });
    const token = await createApiKeyToken({
      cookie: session.cookie,
      env,
      name: "MCP supported capability reader",
      permissions: [OrganizationPermissions.INTEGRATION_CONNECTION_READ],
    });

    const result = await callMcpTool({
      env,
      token,
      name: "list_supported_capabilities",
      arguments: {
        providerFamilyId: "github",
        includeDetails: true,
      },
    });

    expect(result.isError).toBeUndefined();
    const catalog = SupportedCapabilitiesResultSchema.parse(result.structuredContent);
    const githubCloud = catalog.items.find((item) => item.variantId === "github-cloud");
    expect(githubCloud?.capabilities.triggerEvents.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "github.pull_request.review_requested",
        }),
      ]),
    );
    expect(githubCloud?.capabilities.providerResources.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "repository",
        }),
      ]),
    );

    const slackResult = await callMcpTool({
      env,
      token,
      name: "list_supported_capabilities",
      arguments: {
        providerFamilyId: "slack",
      },
    });
    const slackCatalog = SupportedCapabilitiesResultSchema.parse(slackResult.structuredContent);
    expect(slackCatalog.items[0]?.capabilities.runtimeTools.mcpSupported).toBe(true);
  });

  it("filters supported capabilities by capability kind", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-mcp-capabilities-filter@example.com",
    });
    const token = await createApiKeyToken({
      cookie: session.cookie,
      env,
      name: "MCP supported capability filter reader",
      permissions: [OrganizationPermissions.INTEGRATION_CONNECTION_READ],
    });

    const result = await callMcpTool({
      env,
      token,
      name: "list_supported_capabilities",
      arguments: {
        capabilityKind: MistleSupportedCapabilityKinds.TRIGGER_EVENT,
      },
    });

    expect(result.isError).toBeUndefined();
    const catalog = SupportedCapabilitiesResultSchema.parse(result.structuredContent);
    expect(catalog.items.length).toBeGreaterThan(0);
    expect(catalog.items.every((item) => item.capabilities.triggerEvents.eventCount > 0)).toBe(
      true,
    );
  });

  it("allows setup assistant MCP tokens to inspect supported capabilities", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-mcp-capabilities-setup-assistant@example.com",
    });
    const token = await mintMcpToken({
      config: McpTokenConfig,
      claims: {
        kind: "setup_assistant",
        sub: "sbi_mcp_capabilities_setup_assistant",
        organizationId: session.organizationId,
        sandboxProfileId: "sbp_mcp_capabilities_setup_assistant",
        sandboxProfileVersion: 1,
      },
      ttlSeconds: 300,
    });

    const result = await callMcpTool({
      env,
      token: token.token,
      name: "list_supported_capabilities",
      arguments: {
        providerFamilyId: "github",
      },
    });

    expect(result.isError).toBeUndefined();
    const catalog = SupportedCapabilitiesResultSchema.parse(result.structuredContent);
    expect(catalog.items.map((item) => item.variantId)).toEqual([
      "github-cloud",
      "github-enterprise-server",
    ]);
  });

  it("returns a tool error without integration read permission", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-mcp-capabilities-forbidden@example.com",
    });
    const token = await createApiKeyToken({
      cookie: session.cookie,
      env,
      name: "MCP supported capability forbidden reader",
      permissions: [OrganizationPermissions.ORGANIZATION_READ],
    });

    const result = await callMcpTool({
      env,
      token,
      name: "list_supported_capabilities",
      arguments: {},
    });

    expect(result.isError).toBe(true);
  });
});
