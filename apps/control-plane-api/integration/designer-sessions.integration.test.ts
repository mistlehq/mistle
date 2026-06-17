/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { ApiKeyActorKinds } from "@mistle/db/control-plane";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import { generateApiKeySecret } from "../src/api-keys/services/api-key-secret.js";
import { OrganizationPermissions } from "../src/auth/services/organization-policy.js";
import {
  BootstrapDesignerRuntimeConversationResponseSchema,
  DesignerSessionSchema,
  ListDesignerSessionsResponseSchema,
} from "../src/designer/index.js";
import { waitForQueuedStartWorkflowInput } from "./helpers/data-plane-workflows.js";

const it = createIntegrationTest({
  services: ["control-plane-api", "data-plane-api"],
});

describe.concurrent("designer sessions integration", () => {
  it("creates, lists, reads, and updates a Designer session in the authenticated organization", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-designer-session@example.com",
    });

    const createResponse = await env.controlPlaneApi.http.fetch("/v1/designer/sessions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: session.cookie,
      },
      body: JSON.stringify({
        prompt: "Build a triaging agent for Linear and GitHub.",
        idempotencyKey: "designer-session-integration-create",
      }),
    });
    expect(createResponse.status).toBe(201);
    const created = DesignerSessionSchema.parse(await createResponse.json());
    expect(created).toMatchObject({
      organizationId: session.organizationId,
      initialPrompt: "Build a triaging agent for Linear and GitHub.",
      status: "pending",
      connectable: false,
      canvasTabs: [],
    });
    expect(created.id).toMatch(/^dsn_[a-zA-Z0-9_-]+$/);
    expect(created.sandboxInstanceId).toMatch(/^sbi_[a-zA-Z0-9_-]+$/);
    const queuedWorkflowInput = await waitForQueuedStartWorkflowInput({
      env,
      sandboxInstanceId: created.sandboxInstanceId,
    });
    const platformOpenAiRoute = queuedWorkflowInput.runtimePlan.egressRoutes.find(
      (route) => route.credentialResolver.kind === "platform_openai_api_key",
    );
    expect(platformOpenAiRoute?.upstream.baseUrl).toBe("https://api.openai.com/v1");
    const codexConfig = queuedWorkflowInput.runtimePlan.runtimeClients
      .flatMap((client) => client.setup.files)
      .find((file) => file.fileId === "codex_config");
    expect(codexConfig?.content).toContain('base_url = "https://api.openai.com/v1"');

    const listResponse = await env.controlPlaneApi.http.fetch("/v1/designer/sessions", {
      headers: {
        cookie: session.cookie,
      },
    });
    expect(listResponse.status).toBe(200);
    const list = ListDesignerSessionsResponseSchema.parse(await listResponse.json());
    expect(list.items.map((item) => item.id)).toContain(created.id);
    expect(list.items.find((item) => item.id === created.id)).toMatchObject({
      initialPrompt: created.initialPrompt,
      sandboxInstanceId: created.sandboxInstanceId,
      status: "pending",
    });

    const getResponse = await env.controlPlaneApi.http.fetch(
      `/v1/designer/sessions/${encodeURIComponent(created.id)}`,
      {
        headers: {
          cookie: session.cookie,
        },
      },
    );
    expect(getResponse.status).toBe(200);
    const read = DesignerSessionSchema.parse(await getResponse.json());
    expect(read).toMatchObject({
      id: created.id,
      organizationId: session.organizationId,
      sandboxInstanceId: created.sandboxInstanceId,
      initialPrompt: created.initialPrompt,
      canvasTabs: [],
    });

    const updateResponse = await env.controlPlaneApi.http.fetch(
      `/v1/designer/sessions/${encodeURIComponent(created.id)}/canvas-tabs`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
        },
        body: JSON.stringify({
          tabs: [
            {
              id: "integrations",
              title: "Integrations",
              href: "/integrations",
            },
            {
              id: "sandbox-profile",
              title: "Sandbox Profile",
              href: "/sandbox-profiles/sbp_designer/draft",
            },
          ],
        }),
      },
    );
    expect(updateResponse.status).toBe(200);
    const updated = DesignerSessionSchema.parse(await updateResponse.json());
    expect(updated.canvasTabs).toEqual([
      {
        id: "integrations",
        title: "Integrations",
        href: "/integrations",
      },
      {
        id: "sandbox-profile",
        title: "Sandbox Profile",
        href: "/sandbox-profiles/sbp_designer/draft",
      },
    ]);
  });

  it("does not expose Designer sessions across organizations", async ({ env }) => {
    const firstOrgSession = await env.auth.createSession({
      email: "integration-new-designer-session-org-a@example.com",
    });
    const secondOrgSession = await env.auth.createSession({
      email: "integration-new-designer-session-org-b@example.com",
    });

    const createResponse = await env.controlPlaneApi.http.fetch("/v1/designer/sessions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: firstOrgSession.cookie,
      },
      body: JSON.stringify({
        prompt: "Build a triaging agent for the first organization.",
        idempotencyKey: "designer-session-integration-org-boundary",
      }),
    });
    expect(createResponse.status).toBe(201);
    const created = DesignerSessionSchema.parse(await createResponse.json());

    const getFromOtherOrgResponse = await env.controlPlaneApi.http.fetch(
      `/v1/designer/sessions/${encodeURIComponent(created.id)}`,
      {
        headers: {
          cookie: secondOrgSession.cookie,
        },
      },
    );
    expect(getFromOtherOrgResponse.status).toBe(404);

    const updateFromOtherOrgResponse = await env.controlPlaneApi.http.fetch(
      `/v1/designer/sessions/${encodeURIComponent(created.id)}/canvas-tabs`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: secondOrgSession.cookie,
        },
        body: JSON.stringify({
          tabs: [
            {
              id: "integrations",
              title: "Integrations",
              href: "/integrations",
            },
          ],
        }),
      },
    );
    expect(updateFromOtherOrgResponse.status).toBe(404);
  });

  it("rejects API key actors on Designer routes", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-designer-session-api-key@example.com",
    });

    const createResponse = await env.controlPlaneApi.http.fetch("/v1/designer/sessions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: session.cookie,
      },
      body: JSON.stringify({
        prompt: "Build a Designer session that only the user can manage.",
        idempotencyKey: "designer-session-api-key-rejection-create",
      }),
    });
    expect(createResponse.status).toBe(201);
    const created = DesignerSessionSchema.parse(await createResponse.json());

    const apiKeySecret = generateApiKeySecret();
    await env.controlPlaneDb.insert(env.controlPlaneTables.apiKeys).values({
      id: "apk_designer_session_rejection",
      organizationId: session.organizationId,
      name: "Designer rejection",
      secretPrefix: apiKeySecret.secretPrefix,
      secretHash: apiKeySecret.secretHash,
      secretHashAlgorithm: apiKeySecret.secretHashAlgorithm,
      createdByActorKind: ApiKeyActorKinds.USER,
      createdByActorId: session.userId,
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.apiKeyPermissions).values([
      {
        apiKeyId: "apk_designer_session_rejection",
        permission: OrganizationPermissions.DESIGNER_SESSION_CREATE,
      },
      {
        apiKeyId: "apk_designer_session_rejection",
        permission: OrganizationPermissions.DESIGNER_SESSION_READ,
      },
      {
        apiKeyId: "apk_designer_session_rejection",
        permission: OrganizationPermissions.DESIGNER_SESSION_UPDATE,
      },
    ]);

    const apiKeyHeaders = {
      authorization: `Bearer ${apiKeySecret.token}`,
      "content-type": "application/json",
    };

    const rejectedCreateResponse = await env.controlPlaneApi.http.fetch("/v1/designer/sessions", {
      method: "POST",
      headers: apiKeyHeaders,
      body: JSON.stringify({
        prompt: "Build another Designer session.",
        idempotencyKey: "designer-session-api-key-rejection-forbidden",
      }),
    });
    expect(rejectedCreateResponse.status).toBe(403);

    const rejectedListResponse = await env.controlPlaneApi.http.fetch("/v1/designer/sessions", {
      headers: {
        authorization: `Bearer ${apiKeySecret.token}`,
      },
    });
    expect(rejectedListResponse.status).toBe(403);

    const rejectedGetResponse = await env.controlPlaneApi.http.fetch(
      `/v1/designer/sessions/${encodeURIComponent(created.id)}`,
      {
        headers: {
          authorization: `Bearer ${apiKeySecret.token}`,
        },
      },
    );
    expect(rejectedGetResponse.status).toBe(403);

    const rejectedUpdateResponse = await env.controlPlaneApi.http.fetch(
      `/v1/designer/sessions/${encodeURIComponent(created.id)}/canvas-tabs`,
      {
        method: "PUT",
        headers: apiKeyHeaders,
        body: JSON.stringify({
          tabs: [
            {
              id: "integrations",
              title: "Integrations",
              href: "/integrations",
            },
          ],
        }),
      },
    );
    expect(rejectedUpdateResponse.status).toBe(403);

    const rejectedBootstrapResponse = await env.controlPlaneApi.http.fetch(
      `/v1/designer/sessions/${encodeURIComponent(created.id)}/runtime-conversation`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKeySecret.token}`,
        },
      },
    );
    expect(rejectedBootstrapResponse.status).toBe(403);

    const rejectedFollowUpResponse = await env.controlPlaneApi.http.fetch(
      `/v1/designer/sessions/${encodeURIComponent(created.id)}/runtime-conversation/follow-ups`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKeySecret.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          prompt: "Continue Designer setup.",
          idempotencyKey: "designer-session-api-key-rejection-follow-up",
        }),
      },
    );
    expect(rejectedFollowUpResponse.status).toBe(403);
  });

  it("rejects Designer runtime follow-ups before the runtime conversation is ready", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-designer-runtime-follow-up-not-ready@example.com",
    });
    const designerSessionId = "dsn_runtime_follow_up_not_ready";

    await env.controlPlaneDb.insert(env.controlPlaneTables.designerSessions).values({
      id: designerSessionId,
      organizationId: session.organizationId,
      sandboxInstanceId: "sbi_designer_runtime_follow_up_not_ready",
      initialPrompt: "Build a support triage agent.",
      canvasTabs: [],
    });

    const followUpResponse = await env.controlPlaneApi.http.fetch(
      `/v1/designer/sessions/${encodeURIComponent(designerSessionId)}/runtime-conversation/follow-ups`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
        },
        body: JSON.stringify({
          prompt: "Add Slack escalation for urgent support tickets.",
          idempotencyKey: "designer-runtime-follow-up-not-ready",
        }),
      },
    );
    expect(followUpResponse.status).toBe(409);
    expect(await followUpResponse.json()).toEqual({
      code: "DESIGNER_RUNTIME_CONVERSATION_NOT_READY",
      message: `Designer session '${designerSessionId}' runtime conversation is not ready for follow-up submission.`,
    });
  });

  it("returns a persisted completed Designer runtime conversation bootstrap on repeated requests", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-designer-runtime-conversation-completed@example.com",
    });
    const designerSessionId = "dsn_runtime_conversation_completed";
    const submittedAt = "2026-06-18 01:02:03+00";

    await env.controlPlaneDb.insert(env.controlPlaneTables.designerSessions).values({
      id: designerSessionId,
      organizationId: session.organizationId,
      sandboxInstanceId: "sbi_designer_runtime_conversation_completed",
      initialPrompt: "Build a support triage agent.",
      runtimeProviderConversationId: "thread_designer_runtime_conversation_completed",
      initialPromptProviderExecutionId: "turn_designer_runtime_conversation_completed",
      initialPromptSubmittedAt: submittedAt,
      canvasTabs: [],
    });

    const bootstrapUrl = `/v1/designer/sessions/${encodeURIComponent(designerSessionId)}/runtime-conversation`;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const bootstrapResponse = await env.controlPlaneApi.http.fetch(bootstrapUrl, {
        method: "POST",
        headers: {
          cookie: session.cookie,
        },
      });
      expect(bootstrapResponse.status).toBe(200);
      const bootstrap = BootstrapDesignerRuntimeConversationResponseSchema.parse(
        await bootstrapResponse.json(),
      );
      expect(bootstrap).toEqual({
        runtimeConversation: {
          providerConversationId: "thread_designer_runtime_conversation_completed",
          providerExecutionId: "turn_designer_runtime_conversation_completed",
          initialPromptSubmittedAt: submittedAt,
        },
      });
    }

    const persisted = await env.controlPlaneDb.query.designerSessions.findFirst({
      columns: {
        runtimeProviderConversationId: true,
        initialPromptProviderExecutionId: true,
        initialPromptSubmittedAt: true,
      },
      where: (table, { eq }) => eq(table.id, designerSessionId),
    });
    expect(persisted).toEqual({
      runtimeProviderConversationId: "thread_designer_runtime_conversation_completed",
      initialPromptProviderExecutionId: "turn_designer_runtime_conversation_completed",
      initialPromptSubmittedAt: submittedAt,
    });
  });
});
