/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { SandboxProfileStatuses } from "@mistle/db/control-plane";
import {
  createIntegrationTest,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";
import { z } from "zod";

import { OrganizationPermissions } from "../src/auth/services/organization-policy.js";
import {
  ListSandboxProfilesResponseSchema,
  SandboxProfileSchema,
} from "../src/sandbox-profiles/index.js";
import { createApiKeyToken } from "./helpers/api-keys.js";

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

describe.concurrent("MCP profile tools integration", () => {
  it("lists sandbox profiles with the REST response shape scoped to the API key organization", async ({
    env,
  }) => {
    const firstOrgSession = await env.auth.createSession({
      email: "integration-new-mcp-profile-list-a@example.com",
    });
    const secondOrgSession = await env.auth.createSession({
      email: "integration-new-mcp-profile-list-b@example.com",
    });
    const token = await createApiKeyToken({
      cookie: firstOrgSession.cookie,
      env,
      name: "MCP profile reader",
      permissions: [OrganizationPermissions.SANDBOX_PROFILE_READ],
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values([
      {
        id: "sbp_mcp_list_a",
        organizationId: firstOrgSession.organizationId,
        displayName: "MCP List Profile A",
        status: SandboxProfileStatuses.ACTIVE,
        createdAt: "2026-02-01T00:00:00.000Z",
        updatedAt: "2026-02-01T00:00:00.000Z",
      },
      {
        id: "sbp_mcp_list_b",
        organizationId: secondOrgSession.organizationId,
        displayName: "MCP List Profile B",
        status: SandboxProfileStatuses.ACTIVE,
        createdAt: "2026-02-02T00:00:00.000Z",
        updatedAt: "2026-02-02T00:00:00.000Z",
      },
    ]);

    const result = await callMcpTool({
      env,
      token,
      name: "profile_list",
      arguments: {
        limit: 10,
      },
    });

    expect(result.isError).toBeUndefined();
    const profileList = ListSandboxProfilesResponseSchema.parse(result.structuredContent);
    expect(profileList.totalResults).toBe(1);
    expect(profileList.items.map((profile) => profile.id)).toEqual(["sbp_mcp_list_a"]);
  });

  it("gets a sandbox profile with the REST response shape", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-mcp-profile-get@example.com",
    });
    const token = await createApiKeyToken({
      cookie: session.cookie,
      env,
      name: "MCP profile getter",
      permissions: [OrganizationPermissions.SANDBOX_PROFILE_READ],
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values({
      id: "sbp_mcp_get",
      organizationId: session.organizationId,
      displayName: "MCP Get Profile",
      status: SandboxProfileStatuses.ACTIVE,
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
    });

    const result = await callMcpTool({
      env,
      token,
      name: "profile_get",
      arguments: {
        profileId: "sbp_mcp_get",
      },
    });

    expect(result.isError).toBeUndefined();
    const profile = SandboxProfileSchema.parse(result.structuredContent);
    expect(profile.id).toBe("sbp_mcp_get");
    expect(profile.organizationId).toBe(session.organizationId);
    expect(profile.displayName).toBe("MCP Get Profile");
  });

  it("returns a tool error when the API key lacks sandbox profile read permission", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-mcp-profile-forbidden@example.com",
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
      name: "profile_list",
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
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "mcp-test",
      method: "tools/call",
      params: {
        name: input.name,
        arguments: input.arguments,
      },
    }),
  });

  expect(response.status).toBe(200);
  const message = parseStreamableHttpJsonRpcMessage(await response.text());
  return JsonRpcToolResponseSchema.parse(message).result;
}

function parseStreamableHttpJsonRpcMessage(responseBody: string): unknown {
  const dataLine = responseBody.split("\n").find((line) => line.startsWith("data: "));

  if (dataLine === undefined) {
    throw new Error("Expected MCP streamable HTTP response to contain a data line.");
  }

  return JSON.parse(dataLine.slice("data: ".length));
}
