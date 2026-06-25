/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { IntegrationConnectionStatuses } from "@mistle/db/control-plane";
import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";
import { z } from "zod";

import { OrganizationPermissions } from "../src/auth/services/organization-policy.js";
import { CreateFormConnectionBodySchema } from "../src/integration-connections/create-form-connection/schema.js";
import { ListIntegrationConnectionsResponseSchema } from "../src/integration-connections/list-integration-connections/schema.js";
import { CreatedFormIntegrationConnectionSchema } from "../src/integration-connections/schemas.js";
import { ListIntegrationTargetsResponseSchema } from "../src/integration-targets/list-integration-targets/index.js";
import { createApiKeyToken } from "./helpers/api-keys.js";
import { createFormConnection, seedIntegrationTarget } from "./helpers/integration-connections.js";
import { callMcpTool, listMcpTools } from "./helpers/mcp-json-rpc.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

const FormSetupDescriptorSchema = z
  .object({
    kind: z.literal("user_action_integration_setup_descriptor"),
    actionKind: z.literal("form"),
    targetKey: z.string().min(1),
    methodId: z.string().min(1),
    methodLabel: z.string().min(1),
    mode: z.enum(["create", "update"]),
    connectionId: z.string().min(1).optional(),
    suggestedDisplayName: z.string().min(1).optional(),
    suggestedConfig: z.record(z.string(), z.unknown()),
    currentConfig: z.record(z.string(), z.unknown()),
    configuredSecretNames: z.array(z.string().min(1)),
    secretFields: z.array(
      z
        .object({
          name: z.string().min(1),
          label: z.string().min(1),
          placeholder: z.string().min(1).optional(),
          description: z.string().min(1).optional(),
          inputType: z.enum(["password", "text", "textarea"]),
          required: z.boolean(),
          configured: z.boolean(),
        })
        .strict(),
    ),
    directSubmission: z
      .object({
        method: z.enum(["POST", "PUT"]),
        path: z.string().min(1),
      })
      .strict(),
    form: z
      .object({
        schema: z.record(z.string(), z.unknown()),
        uiSchema: z.record(z.string(), z.unknown()).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

describe.concurrent("MCP integration tools", () => {
  it("exposes integration setup input schemas without agent-supplied OAuth config", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-mcp-integration-tools-list@example.com",
    });
    const token = await createApiKeyToken({
      cookie: session.cookie,
      env,
      name: "MCP integration tools lister",
      permissions: [OrganizationPermissions.INTEGRATION_CONNECTION_CREATE],
    });

    const tools = await listMcpTools({ env, token });

    expect(
      tools.find((tool) => tool.name === "integration_connection_oauth_start")?.inputSchema
        .properties,
    ).not.toHaveProperty("config");
  });

  it("lists integration targets and prepares a secret-bearing form setup descriptor without secret values", async ({
    env,
  }) => {
    await seedOpenAiTarget(env);
    const session = await env.auth.createSession({
      email: "integration-new-mcp-integration-setup-prepare@example.com",
    });
    const token = await createApiKeyToken({
      cookie: session.cookie,
      env,
      name: "MCP integration setup preparer",
      permissions: [
        OrganizationPermissions.INTEGRATION_CONNECTION_READ,
        OrganizationPermissions.INTEGRATION_CONNECTION_CREATE,
      ],
    });

    const targetsResult = await callMcpTool({
      env,
      token,
      name: "integration_targets_list",
      arguments: {
        limit: 10,
      },
    });
    expect(targetsResult.isError).toBeUndefined();
    const targets = ListIntegrationTargetsResponseSchema.parse(targetsResult.structuredContent);
    expect(targets.items.some((target) => target.targetKey === "openai-default")).toBe(true);

    const result = await callMcpTool({
      env,
      token,
      name: "integration_connection_form_setup_prepare",
      arguments: {
        targetKey: "openai-default",
        methodId: IntegrationConnectionMethodIds.API_KEY,
        suggestedDisplayName: "Primary OpenAI key",
        suggestedConfig: {
          connection_method: IntegrationConnectionMethodIds.API_KEY,
        },
      },
    });

    expect(result.isError).toBeUndefined();
    const descriptor = FormSetupDescriptorSchema.parse(result.structuredContent);
    expect(descriptor).toMatchObject({
      actionKind: "form",
      targetKey: "openai-default",
      methodId: IntegrationConnectionMethodIds.API_KEY,
      methodLabel: "API key",
      mode: "create",
      suggestedDisplayName: "Primary OpenAI key",
      suggestedConfig: {
        connection_method: IntegrationConnectionMethodIds.API_KEY,
      },
      configuredSecretNames: [],
      directSubmission: {
        method: "POST",
        path: "/v1/integration/connections/openai-default/form",
      },
    });
    expect(descriptor.secretFields).toEqual([
      {
        name: "apiKey",
        label: "API key",
        placeholder: "Enter API key",
        inputType: "password",
        required: true,
        configured: false,
      },
    ]);
    expect(JSON.stringify(descriptor)).not.toContain("slotKey");
    expect(JSON.stringify(descriptor)).not.toContain("secretType");
    expect(JSON.stringify(descriptor)).not.toContain("sk-test");

    const rejectedSecretSuggestion = await callMcpTool({
      env,
      token,
      name: "integration_connection_form_setup_prepare",
      arguments: {
        targetKey: "openai-default",
        methodId: IntegrationConnectionMethodIds.API_KEY,
        suggestedConfig: {
          apiKey: "sk-test-should-not-echo",
        },
      },
    });
    expect(rejectedSecretSuggestion.isError).toBe(true);
    expect(JSON.stringify(rejectedSecretSuggestion)).not.toContain("sk-test-should-not-echo");
  });

  it("returns a user-action descriptor when OAuth setup requires start config", async ({ env }) => {
    await seedIntegrationTarget(env, {
      targetKey: "signoz-mcp",
      familyId: "signoz",
      variantId: "signoz-mcp",
      config: {},
    });
    const session = await env.auth.createSession({
      email: "integration-new-mcp-integration-oauth-start-config@example.com",
    });
    const token = await createApiKeyToken({
      cookie: session.cookie,
      env,
      name: "MCP OAuth setup preparer",
      permissions: [OrganizationPermissions.INTEGRATION_CONNECTION_CREATE],
    });

    const result = await callMcpTool({
      env,
      token,
      name: "integration_connection_oauth_start",
      arguments: {
        targetKey: "signoz-mcp",
        displayName: "SigNoz OAuth",
      },
    });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      kind: "user_action_integration_setup_descriptor",
      actionKind: "oauth_start_form",
      targetKey: "signoz-mcp",
      methodId: "oauth2-authorization-code",
      methodLabel: "SigNoz OAuth",
      suggestedDisplayName: "SigNoz OAuth",
      directSubmission: {
        method: "POST",
        path: "/v1/integration/connections/signoz-mcp/oauth2-authorization-code/start",
      },
      form: {
        schema: expect.objectContaining({
          required: ["region"],
        }),
      },
    });
    expect(JSON.stringify(result.structuredContent)).not.toContain("client_secret");
  });

  it("lists and gets connections with configured secret names after user-owned REST setup", async ({
    env,
  }) => {
    await seedOpenAiTarget(env);
    const session = await env.auth.createSession({
      email: "integration-new-mcp-integration-connection-get@example.com",
    });
    const token = await createApiKeyToken({
      cookie: session.cookie,
      env,
      name: "MCP integration connection reader",
      permissions: [
        OrganizationPermissions.INTEGRATION_CONNECTION_READ,
        OrganizationPermissions.INTEGRATION_CONNECTION_UPDATE,
        OrganizationPermissions.INTEGRATION_WEBHOOK_SOURCE_READ,
      ],
    });
    const createResponse = await createFormConnection({
      env,
      targetKey: "openai-default",
      cookie: session.cookie,
      body: CreateFormConnectionBodySchema.parse({
        displayName: "Primary OpenAI key",
        methodId: IntegrationConnectionMethodIds.API_KEY,
        config: {
          connection_method: IntegrationConnectionMethodIds.API_KEY,
        },
        secrets: {
          apiKey: "sk-test-mcp-integration-secret",
        },
      }),
    });
    expect(createResponse.status).toBe(201);
    const createdConnection = CreatedFormIntegrationConnectionSchema.parse(
      await createResponse.json(),
    );

    const listResult = await callMcpTool({
      env,
      token,
      name: "integration_connections_list",
      arguments: {
        limit: 10,
      },
    });
    expect(listResult.isError).toBeUndefined();
    const connections = ListIntegrationConnectionsResponseSchema.parse(
      listResult.structuredContent,
    );
    expect(connections.items).toEqual([
      expect.objectContaining({
        id: createdConnection.id,
        configuredSecretNames: ["apiKey"],
      }),
    ]);

    const getResult = await callMcpTool({
      env,
      token,
      name: "integration_connection_get",
      arguments: {
        connectionId: createdConnection.id,
      },
    });
    expect(getResult.isError).toBeUndefined();
    expect(getResult.structuredContent).toMatchObject({
      id: createdConnection.id,
      targetKey: "openai-default",
      displayName: "Primary OpenAI key",
      status: IntegrationConnectionStatuses.ACTIVE,
      configuredSecretNames: ["apiKey"],
    });
    expect(JSON.stringify(getResult.structuredContent)).not.toContain(
      "sk-test-mcp-integration-secret",
    );

    const prepareUpdateResult = await callMcpTool({
      env,
      token,
      name: "integration_connection_form_setup_prepare",
      arguments: {
        targetKey: "openai-default",
        methodId: IntegrationConnectionMethodIds.API_KEY,
        connectionId: createdConnection.id,
      },
    });
    expect(prepareUpdateResult.isError).toBeUndefined();
    const descriptor = FormSetupDescriptorSchema.parse(prepareUpdateResult.structuredContent);
    expect(descriptor.mode).toBe("update");
    expect(descriptor.connectionId).toBe(createdConnection.id);
    expect(descriptor.configuredSecretNames).toEqual(["apiKey"]);
    expect(descriptor.secretFields[0]).toEqual(
      expect.objectContaining({
        name: "apiKey",
        configured: true,
      }),
    );
    expect(descriptor.directSubmission).toEqual({
      method: "PUT",
      path: `/v1/integration/connections/${createdConnection.id}/form`,
    });

    const webhookSourcesResult = await callMcpTool({
      env,
      token,
      name: "integration_webhook_sources_list",
      arguments: {
        connectionId: createdConnection.id,
      },
    });
    expect(webhookSourcesResult.isError).toBeUndefined();
    expect(webhookSourcesResult.structuredContent).toEqual({
      items: [],
    });
  });

  it("strips declared secret field names from MCP connection config projections", async ({
    env,
  }) => {
    await seedGitHubTarget(env);
    const session = await env.auth.createSession({
      email: "integration-new-mcp-integration-secret-config-scrub@example.com",
    });
    const token = await createApiKeyToken({
      cookie: session.cookie,
      env,
      name: "MCP integration secret-safe reader",
      permissions: [
        OrganizationPermissions.INTEGRATION_CONNECTION_READ,
        OrganizationPermissions.INTEGRATION_CONNECTION_UPDATE,
      ],
    });

    const createResponse = await createFormConnection({
      env,
      targetKey: "github-cloud",
      cookie: session.cookie,
      body: CreateFormConnectionBodySchema.parse({
        displayName: "GitHub API key",
        methodId: IntegrationConnectionMethodIds.API_KEY,
        config: {
          connection_method: IntegrationConnectionMethodIds.API_KEY,
          apiKey: "github-token-accidentally-in-config",
        },
        secrets: {
          apiKey: "github-token-in-secret-slot",
        },
      }),
    });
    expect(createResponse.status).toBe(201);
    const createdConnection = CreatedFormIntegrationConnectionSchema.parse(
      await createResponse.json(),
    );

    const listResult = await callMcpTool({
      env,
      token,
      name: "integration_connections_list",
      arguments: {
        limit: 10,
      },
    });
    expect(listResult.isError).toBeUndefined();
    const connections = ListIntegrationConnectionsResponseSchema.parse(
      listResult.structuredContent,
    );
    expect(connections.items).toEqual([
      expect.objectContaining({
        id: createdConnection.id,
        config: {
          connection_method: IntegrationConnectionMethodIds.API_KEY,
        },
      }),
    ]);
    expect(JSON.stringify(listResult.structuredContent)).not.toContain(
      "github-token-accidentally-in-config",
    );

    const getResult = await callMcpTool({
      env,
      token,
      name: "integration_connection_get",
      arguments: {
        connectionId: createdConnection.id,
      },
    });
    expect(getResult.isError).toBeUndefined();
    expect(getResult.structuredContent).toMatchObject({
      id: createdConnection.id,
      config: {
        connection_method: IntegrationConnectionMethodIds.API_KEY,
      },
    });
    expect(JSON.stringify(getResult.structuredContent)).not.toContain(
      "github-token-accidentally-in-config",
    );

    const prepareUpdateResult = await callMcpTool({
      env,
      token,
      name: "integration_connection_form_setup_prepare",
      arguments: {
        targetKey: "github-cloud",
        methodId: IntegrationConnectionMethodIds.API_KEY,
        connectionId: createdConnection.id,
      },
    });
    expect(prepareUpdateResult.isError).toBeUndefined();
    const descriptor = FormSetupDescriptorSchema.parse(prepareUpdateResult.structuredContent);
    expect(descriptor.currentConfig).toEqual({
      connection_method: IntegrationConnectionMethodIds.API_KEY,
    });
    expect(JSON.stringify(prepareUpdateResult.structuredContent)).not.toContain(
      "github-token-accidentally-in-config",
    );
  });

  it("rejects update setup descriptors for a different form method than the connection uses", async ({
    env,
  }) => {
    await seedGitHubTarget(env);
    const session = await env.auth.createSession({
      email: "integration-new-mcp-integration-method-mismatch@example.com",
    });
    const token = await createApiKeyToken({
      cookie: session.cookie,
      env,
      name: "MCP integration setup updater",
      permissions: [OrganizationPermissions.INTEGRATION_CONNECTION_UPDATE],
    });

    const createResponse = await createFormConnection({
      env,
      targetKey: "github-cloud",
      cookie: session.cookie,
      body: CreateFormConnectionBodySchema.parse({
        displayName: "GitHub API key",
        methodId: IntegrationConnectionMethodIds.API_KEY,
        config: {
          connection_method: IntegrationConnectionMethodIds.API_KEY,
        },
        secrets: {
          apiKey: "github-token-for-method-mismatch",
        },
      }),
    });
    expect(createResponse.status).toBe(201);
    const createdConnection = CreatedFormIntegrationConnectionSchema.parse(
      await createResponse.json(),
    );

    const result = await callMcpTool({
      env,
      token,
      name: "integration_connection_form_setup_prepare",
      arguments: {
        targetKey: "github-cloud",
        methodId: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
        connectionId: createdConnection.id,
      },
    });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain(
      `Integration connection '${createdConnection.id}' uses method '${IntegrationConnectionMethodIds.API_KEY}', not '${IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION}'.`,
    );
  });
});

async function seedOpenAiTarget(env: Parameters<typeof seedIntegrationTarget>[0]): Promise<void> {
  await seedIntegrationTarget(env, {
    targetKey: "openai-default",
    familyId: "openai",
    variantId: "openai-default",
    config: {
      api_base_url: "https://api.openai.com",
    },
  });
}

async function seedGitHubTarget(env: Parameters<typeof seedIntegrationTarget>[0]): Promise<void> {
  await seedIntegrationTarget(env, {
    targetKey: "github-cloud",
    familyId: "github",
    variantId: "github-cloud",
    config: {
      api_base_url: "https://api.github.com",
      web_base_url: "https://github.com",
    },
  });
}
