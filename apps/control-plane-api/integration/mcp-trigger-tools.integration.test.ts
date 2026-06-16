/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import {
  createIntegrationTest,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";
import { z } from "zod";

import { OrganizationPermissions } from "../src/auth/services/organization-policy.js";
import { GetTriggerResponseSchema } from "../src/triggers/get-trigger/schema.js";
import { ListTriggersResponseSchema } from "../src/triggers/list-triggers/schema.js";
import { createApiKeyToken } from "./helpers/api-keys.js";
import {
  seedPersistedWebhookTrigger,
  seedTriggerWebhookTargets,
  seedWebhookTriggerFixture,
} from "./helpers/trigger-webhooks.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

const JsonRpcToolResponseSchema = z
  .object({
    jsonrpc: z.literal("2.0"),
    id: z.union([z.string(), z.number()]),
    result: z
      .object({
        structuredContent: z.unknown().optional(),
        isError: z.boolean().optional(),
      })
      .loose(),
  })
  .strict();

describe.concurrent("MCP trigger tools integration", () => {
  it("lists and gets triggers with the REST trigger summary response shape", async ({ env }) => {
    const firstOrgSession = await env.auth.createSession({
      email: "integration-new-mcp-trigger-list-a@example.com",
    });
    const secondOrgSession = await env.auth.createSession({
      email: "integration-new-mcp-trigger-list-b@example.com",
    });
    const token = await createApiKeyToken({
      cookie: firstOrgSession.cookie,
      env,
      name: "MCP trigger reader",
      permissions: [OrganizationPermissions.TRIGGER_READ],
    });

    await seedTriggerWebhookTargets(env);
    await seedWebhookTriggerFixture(env, {
      organizationId: firstOrgSession.organizationId,
      connectionId: "icn_mcp_trigger_list_a",
      webhookSourceId: "iws_mcp_trigger_list_a",
      profileId: "sbp_mcp_trigger_list_a",
      profileVersion: 2,
    });
    await seedWebhookTriggerFixture(env, {
      organizationId: secondOrgSession.organizationId,
      connectionId: "icn_mcp_trigger_list_other_org",
      webhookSourceId: "iws_mcp_trigger_list_other_org",
      profileId: "sbp_mcp_trigger_list_other_org",
      profileVersion: 1,
    });
    await seedPersistedWebhookTrigger(env, {
      triggerId: "atm_mcp_trigger_list_a",
      organizationId: firstOrgSession.organizationId,
      webhookSourceId: "iws_mcp_trigger_list_a",
      profileId: "sbp_mcp_trigger_list_a",
      profileVersion: 2,
      targetId: "atg_mcp_trigger_list_a",
      name: "MCP trigger list visible",
      createdAt: "2026-06-01T00:00:00.000Z",
    });
    await seedPersistedWebhookTrigger(env, {
      triggerId: "atm_mcp_trigger_list_other_org",
      organizationId: secondOrgSession.organizationId,
      webhookSourceId: "iws_mcp_trigger_list_other_org",
      profileId: "sbp_mcp_trigger_list_other_org",
      profileVersion: 1,
      targetId: "atg_mcp_trigger_list_other_org",
      name: "MCP trigger list hidden",
      createdAt: "2026-06-02T00:00:00.000Z",
    });

    const listResult = await callMcpTool({
      env,
      token,
      name: "list_triggers",
      arguments: {
        limit: 10,
      },
    });
    const getResult = await callMcpTool({
      env,
      token,
      name: "get_trigger",
      arguments: {
        triggerId: "atm_mcp_trigger_list_a",
      },
    });

    expect(listResult.isError).toBeUndefined();
    expect(getResult.isError).toBeUndefined();
    const triggerList = ListTriggersResponseSchema.parse(listResult.structuredContent);
    const trigger = GetTriggerResponseSchema.parse(getResult.structuredContent);
    expect(triggerList.totalResults).toBe(1);
    expect(triggerList.items.map((item) => item.id)).toEqual(["atm_mcp_trigger_list_a"]);
    expect(trigger).toEqual(triggerList.items[0]);
  });

  it("accepts legacy webhook trigger read permission for trigger read tools", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-mcp-trigger-legacy-read@example.com",
    });
    const token = await createApiKeyToken({
      cookie: session.cookie,
      env,
      name: "MCP legacy webhook trigger reader",
      permissions: [OrganizationPermissions.TRIGGER_WEBHOOK_READ],
    });

    await seedTriggerWebhookTargets(env);
    await seedWebhookTriggerFixture(env, {
      organizationId: session.organizationId,
      connectionId: "icn_mcp_trigger_legacy_read",
      webhookSourceId: "iws_mcp_trigger_legacy_read",
      profileId: "sbp_mcp_trigger_legacy_read",
      profileVersion: 1,
    });
    await seedPersistedWebhookTrigger(env, {
      triggerId: "atm_mcp_trigger_legacy_read",
      organizationId: session.organizationId,
      webhookSourceId: "iws_mcp_trigger_legacy_read",
      profileId: "sbp_mcp_trigger_legacy_read",
      profileVersion: 1,
      targetId: "atg_mcp_trigger_legacy_read",
      name: "MCP legacy trigger read",
    });

    const result = await callMcpTool({
      env,
      token,
      name: "get_trigger",
      arguments: {
        triggerId: "atm_mcp_trigger_legacy_read",
      },
    });

    expect(result.isError).toBeUndefined();
    const trigger = GetTriggerResponseSchema.parse(result.structuredContent);
    expect(trigger.id).toBe("atm_mcp_trigger_legacy_read");
  });

  it("returns a tool error without trigger read permission", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-mcp-trigger-read-forbidden@example.com",
    });
    const token = await createApiKeyToken({
      cookie: session.cookie,
      env,
      name: "MCP organization reader",
      permissions: [OrganizationPermissions.ORGANIZATION_READ],
    });

    const result = await callMcpTool({
      env,
      token,
      name: "list_triggers",
      arguments: {},
    });

    expect(result.isError).toBe(true);
  });
});

async function callMcpTool(input: {
  env: IntegrationTestEnvironment;
  token: string;
  name: string;
  arguments: Record<string, unknown>;
}): Promise<z.infer<typeof JsonRpcToolResponseSchema>["result"]> {
  const response = await input.env.controlPlaneApi.http.fetch("/mcp", {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${input.token}`,
      "content-type": "application/json",
      forwarded: createForwardedHeaderForBaseUrl(input.env.controlPlaneApi.hostBaseUrl),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "mcp-trigger-test",
      method: "tools/call",
      params: {
        name: input.name,
        arguments: input.arguments,
      },
    }),
  });

  expect(response.status).toBe(200);
  return JsonRpcToolResponseSchema.parse(parseStreamableHttpJsonRpcMessage(await response.text()))
    .result;
}

function createForwardedHeaderForBaseUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  return `proto=${url.protocol.slice(0, -1)};host=${url.host}`;
}

function parseStreamableHttpJsonRpcMessage(responseBody: string): unknown {
  const dataLine = responseBody.split("\n").find((line) => line.startsWith("data: "));

  if (dataLine === undefined) {
    throw new Error("Expected MCP streamable HTTP response to contain a data line.");
  }

  return JSON.parse(dataLine.slice("data: ".length));
}
