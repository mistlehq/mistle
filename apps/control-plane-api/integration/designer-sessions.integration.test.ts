/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { Cache, InMemoryCacheAdapter } from "@mistle/cache";
import {
  createDataPlaneSandboxInstancesClient,
  type DataPlaneSandboxInstancesClient,
} from "@mistle/data-plane-internal-client";
import {
  ApiKeyActorKinds,
  DesignerActionRequestStatuses,
  IntegrationBindingKinds,
  IntegrationConnectionStatuses,
  SandboxProfileVersionStates,
} from "@mistle/db/control-plane";
import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { createIntegrationRegistry } from "@mistle/integrations-definitions/server";
import { SandboxProvider } from "@mistle/sandbox";
import {
  createIntegrationTest,
  TestEnvironmentIdHeader,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { and, eq } from "drizzle-orm";
import { describe, expect } from "vitest";

import { generateApiKeySecret } from "../src/api-keys/services/api-key-secret.js";
import { OrganizationPermissions } from "../src/auth/services/organization-policy.js";
import {
  BootstrapDesignerRuntimeConversationResponseSchema,
  DesignerSessionSchema,
  ListDesignerSessionsResponseSchema,
} from "../src/designer/index.js";
import {
  claimDesignerActionRequest,
  markDesignerActionRequestResponseSubmitted,
  readDesignerActionRequestForResponse,
  toDesignerActionRequestOperation,
} from "../src/designer/services/designer-action-requests.js";
import { completeApprovedDesignerActionRequestExecution } from "../src/designer/services/designer-sessions.js";
import {
  countQueuedStartWorkflows,
  waitForQueuedMaterializeWorkflowInput,
  waitForQueuedStartWorkflowInput,
} from "./helpers/data-plane-workflows.js";
import {
  integrationConnectionRow,
  integrationTargetRow,
  sandboxProfileRow,
  sandboxProfileVersionIntegrationBindingRow,
  sandboxProfileVersionRow,
} from "./helpers/sandbox-profiles.js";

const InternalServiceToken = "integration-new-internal-service-token";

const it = createIntegrationTest({
  services: ["control-plane-api", "data-plane-api"],
});

const DesignerOperationSandboxConfig = {
  defaultBaseImage: "docker.io/mistle/designer-test:latest",
  gatewayWsUrl: "ws://127.0.0.1:8080",
  docker: {
    enabled: true,
  },
};

const DesignerOperationIntegrationsConfig = {
  activeMasterEncryptionKeyVersion: 1,
  masterEncryptionKeys: {
    "1": "integration-new-master-key-testing",
  },
};

const DesignerOperationMcpConfig = {
  url: "http://127.0.0.1:3000/mcp",
  trustForwardedHeaders: true,
  auth: {
    secret: "integration-new-mcp-auth-secret",
    issuer: "integration-new-control-plane-api",
    audience: "integration-new-mistle-mcp",
  },
};

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

    const rejectedActionProposalResponse = await env.controlPlaneApi.http.fetch(
      `/v1/designer/sessions/${encodeURIComponent(created.id)}/runtime-conversation/action-proposals/${encodeURIComponent("dap_api_key_rejection")}/responses`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKeySecret.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          response: "approved",
          idempotencyKey: "designer-session-api-key-rejection-action-proposal-response",
        }),
      },
    );
    expect(rejectedActionProposalResponse.status).toBe(403);
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

  it("rejects Designer action proposal responses before the runtime conversation is ready", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-designer-action-proposal-response-not-ready@example.com",
    });
    const designerSessionId = "dsn_action_proposal_response_not_ready";

    await env.controlPlaneDb.insert(env.controlPlaneTables.designerSessions).values({
      id: designerSessionId,
      organizationId: session.organizationId,
      sandboxInstanceId: "sbi_designer_action_proposal_response_not_ready",
      initialPrompt: "Build a support triage agent.",
      canvasTabs: [],
    });

    const response = await env.controlPlaneApi.http.fetch(
      `/v1/designer/sessions/${encodeURIComponent(designerSessionId)}/runtime-conversation/action-proposals/${encodeURIComponent("dap_support_label")}/responses`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
        },
        body: JSON.stringify({
          response: "declined",
          idempotencyKey: "designer-action-proposal-response-not-ready",
        }),
      },
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: "DESIGNER_RUNTIME_CONVERSATION_NOT_READY",
      message: `Designer session '${designerSessionId}' runtime conversation is not ready for follow-up submission.`,
    });
  });

  it("validates Designer action proposal response payloads", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-designer-action-proposal-response-validation@example.com",
    });
    const designerSessionId = "dsn_action_proposal_response_validation";

    await env.controlPlaneDb.insert(env.controlPlaneTables.designerSessions).values({
      id: designerSessionId,
      organizationId: session.organizationId,
      sandboxInstanceId: "sbi_designer_action_proposal_response_validation",
      initialPrompt: "Build a support triage agent.",
      runtimeProviderConversationId: "thread_action_proposal_response_validation",
      initialPromptProviderExecutionId: "turn_action_proposal_response_validation",
      initialPromptSubmittedAt: "2026-06-18 01:02:03+00",
      canvasTabs: [],
    });

    const response = await env.controlPlaneApi.http.fetch(
      `/v1/designer/sessions/${encodeURIComponent(designerSessionId)}/runtime-conversation/action-proposals/${encodeURIComponent("dap_support_label")}/responses`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
        },
        body: JSON.stringify({
          response: "accepted",
          idempotencyKey: "designer-action-proposal-response-validation",
        }),
      },
    );
    expect(response.status).toBe(400);
  });

  it("persists Designer action request ownership with proposal response idempotency", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-designer-action-request-idempotency@example.com",
    });
    const designerSessionId = "dsn_action_request_idempotency";
    const proposalId = "dap_action_request_idempotency";

    await env.controlPlaneDb.insert(env.controlPlaneTables.designerSessions).values({
      id: designerSessionId,
      organizationId: session.organizationId,
      sandboxInstanceId: "sbi_designer_action_request_idempotency",
      initialPrompt: "Build a support triage agent.",
      runtimeProviderConversationId: "thread_action_request_idempotency",
      initialPromptProviderExecutionId: "turn_action_request_idempotency",
      initialPromptSubmittedAt: "2026-06-18 01:02:03+00",
      canvasTabs: [],
    });

    const operation = toDesignerActionRequestOperation({
      kind: "providerConfigurationChange",
      provider: "github",
      resourceType: "label",
      resourceLabel: "mistlehq/mistle",
      action: "Create label",
      details: [
        {
          label: "Label",
          value: "ai-triage",
        },
      ],
    });
    const claimed = await claimDesignerActionRequest(
      {
        db: env.controlPlaneDb,
      },
      {
        organizationId: session.organizationId,
        sessionId: designerSessionId,
        proposalId,
        response: "approved",
        responseIdempotencyKey: "designer-action-request-idempotency",
        requestedByUserId: session.userId,
        runtimeProviderConversationId: "thread_action_request_idempotency",
        operation,
      },
    );
    expect(claimed.created).toBe(true);
    expect(claimed.actionRequest).toMatchObject({
      organizationId: session.organizationId,
      designerSessionId,
      proposalId,
      response: "approved",
      responseIdempotencyKey: "designer-action-request-idempotency",
      requestedByUserId: session.userId,
      runtimeProviderConversationId: "thread_action_request_idempotency",
      operationKind: "providerConfigurationChange",
      operation,
      status: DesignerActionRequestStatuses.APPROVED,
    });

    const repeated = await claimDesignerActionRequest(
      {
        db: env.controlPlaneDb,
      },
      {
        organizationId: session.organizationId,
        sessionId: designerSessionId,
        proposalId,
        response: "approved",
        responseIdempotencyKey: "designer-action-request-idempotency",
        requestedByUserId: session.userId,
        runtimeProviderConversationId: "thread_action_request_idempotency",
        operation,
      },
    );
    expect(repeated).toMatchObject({
      created: false,
      actionRequest: {
        id: claimed.actionRequest.id,
      },
    });

    await expect(
      claimDesignerActionRequest(
        {
          db: env.controlPlaneDb,
        },
        {
          organizationId: session.organizationId,
          sessionId: designerSessionId,
          proposalId,
          response: "declined",
          responseIdempotencyKey: "designer-action-request-conflicting-response",
          requestedByUserId: session.userId,
          runtimeProviderConversationId: "thread_action_request_idempotency",
          operation,
        },
      ),
    ).rejects.toMatchObject({
      code: "DESIGNER_ACTION_PROPOSAL_NOT_PENDING",
    });

    const submitted = await markDesignerActionRequestResponseSubmitted(
      {
        db: env.controlPlaneDb,
      },
      {
        organizationId: session.organizationId,
        actionRequestId: claimed.actionRequest.id,
        runtimeProviderExecutionId: "turn_action_request_response",
        responseSubmittedAt: "2026-06-18 01:03:04+00",
      },
    );
    expect(submitted).toMatchObject({
      id: claimed.actionRequest.id,
      runtimeProviderExecutionId: "turn_action_request_response",
      responseSubmittedAt: "2026-06-18 01:03:04+00",
      status: DesignerActionRequestStatuses.APPROVED,
    });

    const completedResponse = await completeDesignerActionRequestExecution(env, {
      organizationId: session.organizationId,
      actionRequest: submitted,
      response: {
        actionProposalResponse: {
          proposalId,
          response: "approved",
          providerConversationId: "thread_action_request_idempotency",
          providerExecutionId: "turn_action_request_response",
          submittedAt: "2026-06-18 01:03:04+00",
        },
        actionRequest: {
          id: submitted.id,
          status: submitted.status,
          failureCode: submitted.failureCode,
          failureMessage: submitted.failureMessage,
          operationResult: submitted.operationResult,
        },
      },
    });
    expect(completedResponse.actionRequest).toMatchObject({
      id: submitted.id,
      status: DesignerActionRequestStatuses.EXECUTION_UNSUPPORTED,
      failureCode: "DESIGNER_OPERATION_HANDLER_UNSUPPORTED",
      operationResult: null,
    });

    await expect(
      readDesignerActionRequestForResponse(
        {
          db: env.controlPlaneDb,
        },
        {
          organizationId: session.organizationId,
          sessionId: designerSessionId,
          proposalId,
          response: "approved",
          responseIdempotencyKey: "designer-action-request-idempotency",
        },
      ),
    ).resolves.toMatchObject({
      id: claimed.actionRequest.id,
      status: DesignerActionRequestStatuses.EXECUTION_UNSUPPORTED,
      runtimeProviderExecutionId: "turn_action_request_response",
      responseSubmittedAt: "2026-06-18 01:03:04+00",
      operationResult: null,
    });
  });

  it("executes an approved typed Designer operation for a sandbox profile draft setup script", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-designer-profile-setup-script-operation@example.com",
    });
    const designerSessionId = "dsn_profile_setup_script_operation";
    const proposalId = "dap_profile_setup_script_operation";
    const profileId = "sbp_designer_setup_script_operation";

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: profileId,
        organizationId: session.organizationId,
        displayName: "Designer Setup Script Operation",
        createdAt: "2026-06-18T02:00:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: profileId,
        version: 2,
        state: SandboxProfileVersionStates.DRAFT,
        setupScript: "pnpm install",
        sandboxProvider: SandboxProvider.DOCKER,
        sandboxConnectionId: null,
        sandboxVcpuCount: null,
        sandboxMemoryMb: null,
        sandboxDiskMb: null,
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.designerSessions).values({
      id: designerSessionId,
      organizationId: session.organizationId,
      sandboxInstanceId: "sbi_designer_profile_setup_script_operation",
      initialPrompt: "Update the profile setup script.",
      runtimeProviderConversationId: "thread_profile_setup_script_operation",
      initialPromptProviderExecutionId: "turn_profile_setup_script_operation",
      initialPromptSubmittedAt: "2026-06-18 02:01:00+00",
      canvasTabs: [],
    });

    const operation = toDesignerActionRequestOperation({
      kind: "sandboxProfileDraftSetupScriptPut",
      profileId,
      version: 2,
      setupScript: "pnpm install\npnpm build",
    });
    const claimed = await claimDesignerActionRequest(
      {
        db: env.controlPlaneDb,
      },
      {
        organizationId: session.organizationId,
        sessionId: designerSessionId,
        proposalId,
        response: "approved",
        responseIdempotencyKey: "designer-profile-setup-script-operation",
        requestedByUserId: session.userId,
        runtimeProviderConversationId: "thread_profile_setup_script_operation",
        operation,
      },
    );
    const submitted = await markDesignerActionRequestResponseSubmitted(
      {
        db: env.controlPlaneDb,
      },
      {
        organizationId: session.organizationId,
        actionRequestId: claimed.actionRequest.id,
        runtimeProviderExecutionId: "turn_profile_setup_script_response",
        responseSubmittedAt: "2026-06-18 02:02:00+00",
      },
    );

    const completed = await completeDesignerActionRequestExecution(env, {
      organizationId: session.organizationId,
      actionRequest: submitted,
      response: {
        actionProposalResponse: {
          proposalId,
          response: "approved",
          providerConversationId: "thread_profile_setup_script_operation",
          providerExecutionId: "turn_profile_setup_script_response",
          submittedAt: "2026-06-18 02:02:00+00",
        },
        actionRequest: {
          id: submitted.id,
          status: submitted.status,
          failureCode: submitted.failureCode,
          failureMessage: submitted.failureMessage,
          operationResult: submitted.operationResult,
        },
      },
    });
    expect(completed.actionRequest).toMatchObject({
      id: submitted.id,
      status: DesignerActionRequestStatuses.COMPLETED,
      failureCode: null,
      failureMessage: null,
      operationResult: {
        kind: "sandboxProfileDraftSetupScriptPut",
        profileId,
        version: 2,
      },
    });

    const persistedVersion = await env.controlPlaneDb.query.sandboxProfileVersions.findFirst({
      columns: {
        setupScript: true,
      },
      where: (table, { and: whereAnd, eq: whereEq }) =>
        whereAnd(whereEq(table.sandboxProfileId, profileId), whereEq(table.version, 2)),
    });
    expect(persistedVersion).toEqual({
      setupScript: "pnpm install\npnpm build",
    });
  });

  it("fails an approved Designer setup script operation when the approving user loses profile update access", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-designer-profile-setup-script-operation-forbidden@example.com",
    });
    const designerSessionId = "dsn_profile_setup_script_operation_forbidden";
    const proposalId = "dap_profile_setup_script_operation_forbidden";
    const profileId = "sbp_designer_setup_script_operation_forbidden";

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: profileId,
        organizationId: session.organizationId,
        displayName: "Designer Forbidden Setup Script Operation",
        createdAt: "2026-06-18T02:10:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values(
      sandboxProfileVersionRow({
        sandboxProfileId: profileId,
        version: 1,
        state: SandboxProfileVersionStates.DRAFT,
        setupScript: "pnpm unchanged",
        sandboxProvider: SandboxProvider.DOCKER,
        sandboxConnectionId: null,
        sandboxVcpuCount: null,
        sandboxMemoryMb: null,
        sandboxDiskMb: null,
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.designerSessions).values({
      id: designerSessionId,
      organizationId: session.organizationId,
      sandboxInstanceId: "sbi_designer_profile_setup_script_operation_forbidden",
      initialPrompt: "Update the profile setup script.",
      runtimeProviderConversationId: "thread_profile_setup_script_operation_forbidden",
      initialPromptProviderExecutionId: "turn_profile_setup_script_operation_forbidden",
      initialPromptSubmittedAt: "2026-06-18 02:11:00+00",
      canvasTabs: [],
    });

    const operation = toDesignerActionRequestOperation({
      kind: "sandboxProfileDraftSetupScriptPut",
      profileId,
      version: 1,
      setupScript: "pnpm should-not-persist",
    });
    const claimed = await claimDesignerActionRequest(
      {
        db: env.controlPlaneDb,
      },
      {
        organizationId: session.organizationId,
        sessionId: designerSessionId,
        proposalId,
        response: "approved",
        responseIdempotencyKey: "designer-profile-setup-script-operation-forbidden",
        requestedByUserId: session.userId,
        runtimeProviderConversationId: "thread_profile_setup_script_operation_forbidden",
        operation,
      },
    );
    const submitted = await markDesignerActionRequestResponseSubmitted(
      {
        db: env.controlPlaneDb,
      },
      {
        organizationId: session.organizationId,
        actionRequestId: claimed.actionRequest.id,
        runtimeProviderExecutionId: "turn_profile_setup_script_response_forbidden",
        responseSubmittedAt: "2026-06-18 02:12:00+00",
      },
    );

    await env.controlPlaneDb
      .delete(env.controlPlaneTables.members)
      .where(
        and(
          eq(env.controlPlaneTables.members.organizationId, session.organizationId),
          eq(env.controlPlaneTables.members.userId, session.userId),
        ),
      );

    const completed = await completeDesignerActionRequestExecution(env, {
      organizationId: session.organizationId,
      actionRequest: submitted,
      response: {
        actionProposalResponse: {
          proposalId,
          response: "approved",
          providerConversationId: "thread_profile_setup_script_operation_forbidden",
          providerExecutionId: "turn_profile_setup_script_response_forbidden",
          submittedAt: "2026-06-18 02:12:00+00",
        },
        actionRequest: {
          id: submitted.id,
          status: submitted.status,
          failureCode: submitted.failureCode,
          failureMessage: submitted.failureMessage,
          operationResult: submitted.operationResult,
        },
      },
    });
    expect(completed.actionRequest).toMatchObject({
      id: submitted.id,
      status: DesignerActionRequestStatuses.FAILED,
      failureCode: "FORBIDDEN",
      failureMessage: "Forbidden API request.",
      operationResult: null,
    });

    const persistedVersion = await env.controlPlaneDb.query.sandboxProfileVersions.findFirst({
      columns: {
        setupScript: true,
      },
      where: (table, { and: whereAnd, eq: whereEq }) =>
        whereAnd(whereEq(table.sandboxProfileId, profileId), whereEq(table.version, 1)),
    });
    expect(persistedVersion).toEqual({
      setupScript: "pnpm unchanged",
    });
  });

  it("executes an approved typed Designer operation to publish a sandbox profile draft", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-designer-profile-publish-operation@example.com",
    });
    const designerSessionId = "dsn_profile_publish_operation";
    const proposalId = "dap_profile_publish_operation";
    const profileId = "sbp_designer_publish_operation";

    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationTargets).values(
      integrationTargetRow({
        targetKey: "openai-designer-publish-operation",
        variantId: "openai-default",
        enabled: true,
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values(
      integrationConnectionRow({
        id: "icn_designer_publish_operation",
        organizationId: session.organizationId,
        targetKey: "openai-designer-publish-operation",
        displayName: "Designer Publish Operation Connection",
        status: IntegrationConnectionStatuses.ACTIVE,
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values(
      sandboxProfileRow({
        id: profileId,
        organizationId: session.organizationId,
        displayName: "Designer Publish Operation",
        activeVersion: 1,
        createdAt: "2026-06-18T02:20:00.000Z",
      }),
    );
    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfileVersions).values([
      sandboxProfileVersionRow({
        sandboxProfileId: profileId,
        version: 1,
        state: SandboxProfileVersionStates.PUBLISHED,
        publishedAt: "2026-06-18T02:21:00.000Z",
      }),
      sandboxProfileVersionRow({
        sandboxProfileId: profileId,
        version: 2,
        state: SandboxProfileVersionStates.DRAFT,
        sandboxProvider: SandboxProvider.DOCKER,
      }),
    ]);
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.sandboxProfileVersionIntegrationBindings)
      .values(
        sandboxProfileVersionIntegrationBindingRow({
          id: "ibd_designer_publish_operation_agent",
          sandboxProfileId: profileId,
          sandboxProfileVersion: 2,
          connectionId: "icn_designer_publish_operation",
          kind: IntegrationBindingKinds.AGENT,
        }),
      );
    await env.controlPlaneDb.insert(env.controlPlaneTables.designerSessions).values({
      id: designerSessionId,
      organizationId: session.organizationId,
      sandboxInstanceId: "sbi_designer_profile_publish_operation",
      initialPrompt: "Publish the draft profile.",
      runtimeProviderConversationId: "thread_profile_publish_operation",
      initialPromptProviderExecutionId: "turn_profile_publish_operation",
      initialPromptSubmittedAt: "2026-06-18 02:22:00+00",
      canvasTabs: [],
    });

    const operation = toDesignerActionRequestOperation({
      kind: "sandboxProfileDraftPublish",
      profileId,
      version: 2,
    });
    const claimed = await claimDesignerActionRequest(
      {
        db: env.controlPlaneDb,
      },
      {
        organizationId: session.organizationId,
        sessionId: designerSessionId,
        proposalId,
        response: "approved",
        responseIdempotencyKey: "designer-profile-publish-operation",
        requestedByUserId: session.userId,
        runtimeProviderConversationId: "thread_profile_publish_operation",
        operation,
      },
    );
    const submitted = await markDesignerActionRequestResponseSubmitted(
      {
        db: env.controlPlaneDb,
      },
      {
        organizationId: session.organizationId,
        actionRequestId: claimed.actionRequest.id,
        runtimeProviderExecutionId: "turn_profile_publish_response",
        responseSubmittedAt: "2026-06-18 02:23:00+00",
      },
    );

    const response = {
      actionProposalResponse: {
        proposalId,
        response: submitted.response,
        providerConversationId: "thread_profile_publish_operation",
        providerExecutionId: "turn_profile_publish_response",
        submittedAt: "2026-06-18 02:23:00+00",
      },
      actionRequest: {
        id: submitted.id,
        status: submitted.status,
        failureCode: submitted.failureCode,
        failureMessage: submitted.failureMessage,
        operationResult: submitted.operationResult,
      },
    };
    const completed = await completeDesignerActionRequestExecution(env, {
      organizationId: session.organizationId,
      actionRequest: submitted,
      response,
    });
    expect(completed.actionRequest).toMatchObject({
      id: submitted.id,
      status: DesignerActionRequestStatuses.COMPLETED,
      failureCode: null,
      failureMessage: null,
    });

    const persistedVersion = await env.controlPlaneDb.query.sandboxProfileVersions.findFirst({
      columns: {
        state: true,
        publishedAt: true,
      },
      where: (table, { and: whereAnd, eq: whereEq }) =>
        whereAnd(whereEq(table.sandboxProfileId, profileId), whereEq(table.version, 2)),
    });
    expect(persistedVersion?.state).toBe(SandboxProfileVersionStates.PUBLISHED);
    expect(persistedVersion?.publishedAt).not.toBeNull();

    const snapshotJobs = await env.controlPlaneDb.query.sandboxProfileVersionSnapshotJobs.findMany({
      where: (table, { and: whereAnd, eq: whereEq }) =>
        whereAnd(
          whereEq(table.sandboxProfileId, profileId),
          whereEq(table.sandboxProfileVersion, 2),
        ),
    });
    expect(snapshotJobs).toHaveLength(1);
    const [snapshotJob] = snapshotJobs;
    if (snapshotJob === undefined || snapshotJob.sandboxInstanceId === null) {
      throw new Error("Expected Designer publish operation to create a snapshot job.");
    }
    const queuedWorkflowInput = await waitForQueuedMaterializeWorkflowInput({
      env,
      snapshotJobId: snapshotJob.id,
    });
    expect(queuedWorkflowInput).toMatchObject({
      snapshotJobId: snapshotJob.id,
      sandboxInstanceId: snapshotJob.sandboxInstanceId,
      sandboxProfileId: profileId,
      sandboxProfileVersion: 2,
      snapshotPreparationScriptKind: "setup",
    });
    expect(completed.actionRequest.operationResult).toEqual({
      kind: "sandboxProfileDraftPublish",
      profileId,
      version: 2,
      publishedAt: persistedVersion?.publishedAt,
      snapshotAction: {
        kind: "created",
        snapshotJobId: snapshotJob.id,
        sandboxInstanceId: snapshotJob.sandboxInstanceId,
      },
    });

    const repeated = await completeDesignerActionRequestExecution(env, {
      organizationId: session.organizationId,
      actionRequest: submitted,
      response,
    });
    expect(repeated.actionRequest).toMatchObject({
      id: submitted.id,
      status: DesignerActionRequestStatuses.COMPLETED,
      operationResult: completed.actionRequest.operationResult,
    });
    const repeatedSnapshotJobs =
      await env.controlPlaneDb.query.sandboxProfileVersionSnapshotJobs.findMany({
        where: (table, { and: whereAnd, eq: whereEq }) =>
          whereAnd(
            whereEq(table.sandboxProfileId, profileId),
            whereEq(table.sandboxProfileVersion, 2),
          ),
      });
    expect(repeatedSnapshotJobs.map((job) => job.id)).toEqual([snapshotJob.id]);
  });

  it("executes an approved typed Designer operation to launch an ordinary sandbox session", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-designer-profile-launch-operation@example.com",
    });
    const designerSessionId = "dsn_profile_launch_operation";
    const proposalId = "dap_profile_launch_operation";
    const profileId = "sbp_designer_launch_operation";

    await createDesignerLaunchableProfile({
      env,
      organizationId: session.organizationId,
      profileId,
      targetKey: "openai-designer-launch-operation",
      connectionId: "icn_designer_launch_operation",
      bindingId: "ibd_designer_launch_operation_agent",
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.designerSessions).values({
      id: designerSessionId,
      organizationId: session.organizationId,
      sandboxInstanceId: "sbi_designer_profile_launch_operation",
      initialPrompt: "Launch the configured profile.",
      runtimeProviderConversationId: "thread_profile_launch_operation",
      initialPromptProviderExecutionId: "turn_profile_launch_operation",
      initialPromptSubmittedAt: "2026-06-18 02:30:00+00",
      canvasTabs: [],
    });

    const operation = toDesignerActionRequestOperation({
      kind: "sandboxProfileVersionLaunch",
      profileId,
      version: 1,
      idempotencyKey: "designer-profile-launch-operation-start",
    });
    const claimed = await claimDesignerActionRequest(
      {
        db: env.controlPlaneDb,
      },
      {
        organizationId: session.organizationId,
        sessionId: designerSessionId,
        proposalId,
        response: "approved",
        responseIdempotencyKey: "designer-profile-launch-operation",
        requestedByUserId: session.userId,
        runtimeProviderConversationId: "thread_profile_launch_operation",
        operation,
      },
    );
    const submitted = await markDesignerActionRequestResponseSubmitted(
      {
        db: env.controlPlaneDb,
      },
      {
        organizationId: session.organizationId,
        actionRequestId: claimed.actionRequest.id,
        runtimeProviderExecutionId: "turn_profile_launch_response",
        responseSubmittedAt: "2026-06-18 02:31:00+00",
      },
    );

    const response = {
      actionProposalResponse: {
        proposalId,
        response: submitted.response,
        providerConversationId: "thread_profile_launch_operation",
        providerExecutionId: "turn_profile_launch_response",
        submittedAt: "2026-06-18 02:31:00+00",
      },
      actionRequest: {
        id: submitted.id,
        status: submitted.status,
        failureCode: submitted.failureCode,
        failureMessage: submitted.failureMessage,
        operationResult: submitted.operationResult,
      },
    };
    const completed = await completeDesignerActionRequestExecution(env, {
      organizationId: session.organizationId,
      actionRequest: submitted,
      response,
    });
    expect(completed.actionRequest).toMatchObject({
      id: submitted.id,
      status: DesignerActionRequestStatuses.COMPLETED,
      failureCode: null,
      failureMessage: null,
    });

    const launchedInstance = await env.dataPlaneDb.query.sandboxInstances.findFirst({
      columns: {
        id: true,
        purpose: true,
        source: true,
        startedByKind: true,
        startedById: true,
      },
      where: (table, { and: whereAnd, eq: whereEq }) =>
        whereAnd(
          whereEq(table.organizationId, session.organizationId),
          whereEq(table.sandboxProfileId, profileId),
          whereEq(table.sandboxProfileVersion, 1),
        ),
    });
    if (launchedInstance === undefined) {
      throw new Error("Expected Designer launch operation to create a sandbox session.");
    }
    expect(launchedInstance).toMatchObject({
      purpose: "session",
      source: "dashboard",
      startedByKind: "user",
      startedById: session.userId,
    });
    expect(completed.actionRequest.operationResult).toMatchObject({
      kind: "sandboxProfileVersionLaunch",
      profileId,
      version: 1,
      sandboxInstanceId: launchedInstance.id,
    });
    if (completed.actionRequest.operationResult?.kind !== "sandboxProfileVersionLaunch") {
      throw new Error("Expected Designer launch operation to persist a launch result.");
    }
    expect(completed.actionRequest.operationResult.workflowRunId.length).toBeGreaterThan(0);

    const queuedWorkflowInput = await waitForQueuedStartWorkflowInput({
      env,
      sandboxInstanceId: launchedInstance.id,
    });
    expect(queuedWorkflowInput).toMatchObject({
      sandboxInstanceId: launchedInstance.id,
      sandboxProfileVersion: 1,
      purpose: "session",
      startedBy: {
        kind: "user",
        id: session.userId,
      },
      actingUserId: session.userId,
    });

    const repeated = await completeDesignerActionRequestExecution(env, {
      organizationId: session.organizationId,
      actionRequest: submitted,
      response,
    });
    expect(repeated.actionRequest).toMatchObject({
      id: submitted.id,
      status: DesignerActionRequestStatuses.COMPLETED,
      operationResult: completed.actionRequest.operationResult,
    });
    await expect(
      countQueuedStartWorkflows({
        env,
        inputEquals: {
          sandboxProfileId: profileId,
          sandboxProfileVersion: 1,
          startedBy: {
            kind: "user",
            id: session.userId,
          },
        },
      }),
    ).resolves.toBe(1);

    const secondProposalId = "dap_profile_launch_operation_same_key";
    const secondClaimed = await claimDesignerActionRequest(
      {
        db: env.controlPlaneDb,
      },
      {
        organizationId: session.organizationId,
        sessionId: designerSessionId,
        proposalId: secondProposalId,
        response: "approved",
        responseIdempotencyKey: "designer-profile-launch-operation-same-key",
        requestedByUserId: session.userId,
        runtimeProviderConversationId: "thread_profile_launch_operation",
        operation,
      },
    );
    const secondSubmitted = await markDesignerActionRequestResponseSubmitted(
      {
        db: env.controlPlaneDb,
      },
      {
        organizationId: session.organizationId,
        actionRequestId: secondClaimed.actionRequest.id,
        runtimeProviderExecutionId: "turn_profile_launch_response_same_key",
        responseSubmittedAt: "2026-06-18 02:32:00+00",
      },
    );

    const secondCompleted = await completeDesignerActionRequestExecution(env, {
      organizationId: session.organizationId,
      actionRequest: secondSubmitted,
      response: {
        actionProposalResponse: {
          proposalId: secondProposalId,
          response: "approved",
          providerConversationId: "thread_profile_launch_operation",
          providerExecutionId: "turn_profile_launch_response_same_key",
          submittedAt: "2026-06-18 02:32:00+00",
        },
        actionRequest: {
          id: secondSubmitted.id,
          status: secondSubmitted.status,
          failureCode: secondSubmitted.failureCode,
          failureMessage: secondSubmitted.failureMessage,
          operationResult: secondSubmitted.operationResult,
        },
      },
    });
    expect(secondCompleted.actionRequest).toMatchObject({
      id: secondSubmitted.id,
      status: DesignerActionRequestStatuses.COMPLETED,
      operationResult: {
        kind: "sandboxProfileVersionLaunch",
        profileId,
        version: 1,
      },
    });
    await expect(
      countQueuedStartWorkflows({
        env,
        inputEquals: {
          sandboxProfileId: profileId,
          sandboxProfileVersion: 1,
          startedBy: {
            kind: "user",
            id: session.userId,
          },
        },
      }),
    ).resolves.toBe(2);
  });

  it("fails an approved Designer launch operation when the approving user loses session create access", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-designer-profile-launch-operation-forbidden@example.com",
    });
    const designerSessionId = "dsn_profile_launch_operation_forbidden";
    const proposalId = "dap_profile_launch_operation_forbidden";
    const profileId = "sbp_designer_launch_operation_forbidden";

    await createDesignerLaunchableProfile({
      env,
      organizationId: session.organizationId,
      profileId,
      targetKey: "openai-designer-launch-operation-forbidden",
      connectionId: "icn_designer_launch_operation_forbidden",
      bindingId: "ibd_designer_launch_operation_forbidden_agent",
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.designerSessions).values({
      id: designerSessionId,
      organizationId: session.organizationId,
      sandboxInstanceId: "sbi_designer_profile_launch_operation_forbidden",
      initialPrompt: "Launch the configured profile.",
      runtimeProviderConversationId: "thread_profile_launch_operation_forbidden",
      initialPromptProviderExecutionId: "turn_profile_launch_operation_forbidden",
      initialPromptSubmittedAt: "2026-06-18 02:40:00+00",
      canvasTabs: [],
    });

    const operation = toDesignerActionRequestOperation({
      kind: "sandboxProfileVersionLaunch",
      profileId,
      version: 1,
      idempotencyKey: "designer-profile-launch-operation-forbidden-start",
    });
    const claimed = await claimDesignerActionRequest(
      {
        db: env.controlPlaneDb,
      },
      {
        organizationId: session.organizationId,
        sessionId: designerSessionId,
        proposalId,
        response: "approved",
        responseIdempotencyKey: "designer-profile-launch-operation-forbidden",
        requestedByUserId: session.userId,
        runtimeProviderConversationId: "thread_profile_launch_operation_forbidden",
        operation,
      },
    );
    const submitted = await markDesignerActionRequestResponseSubmitted(
      {
        db: env.controlPlaneDb,
      },
      {
        organizationId: session.organizationId,
        actionRequestId: claimed.actionRequest.id,
        runtimeProviderExecutionId: "turn_profile_launch_response_forbidden",
        responseSubmittedAt: "2026-06-18 02:41:00+00",
      },
    );

    await env.controlPlaneDb
      .delete(env.controlPlaneTables.members)
      .where(
        and(
          eq(env.controlPlaneTables.members.organizationId, session.organizationId),
          eq(env.controlPlaneTables.members.userId, session.userId),
        ),
      );

    const completed = await completeDesignerActionRequestExecution(env, {
      organizationId: session.organizationId,
      actionRequest: submitted,
      response: {
        actionProposalResponse: {
          proposalId,
          response: "approved",
          providerConversationId: "thread_profile_launch_operation_forbidden",
          providerExecutionId: "turn_profile_launch_response_forbidden",
          submittedAt: "2026-06-18 02:41:00+00",
        },
        actionRequest: {
          id: submitted.id,
          status: submitted.status,
          failureCode: submitted.failureCode,
          failureMessage: submitted.failureMessage,
          operationResult: submitted.operationResult,
        },
      },
    });
    expect(completed.actionRequest).toMatchObject({
      id: submitted.id,
      status: DesignerActionRequestStatuses.FAILED,
      failureCode: "FORBIDDEN",
      failureMessage: "Forbidden API request.",
      operationResult: null,
    });

    await expect(
      countQueuedStartWorkflows({
        env,
        inputEquals: {
          sandboxProfileId: profileId,
          sandboxProfileVersion: 1,
          startedBy: {
            kind: "user",
            id: session.userId,
          },
        },
      }),
    ).resolves.toBe(0);
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

async function createDesignerLaunchableProfile(input: {
  env: IntegrationTestEnvironment;
  organizationId: string;
  profileId: string;
  targetKey: string;
  connectionId: string;
  bindingId: string;
}) {
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.integrationTargets).values(
    integrationTargetRow({
      targetKey: input.targetKey,
      variantId: "openai-default",
      enabled: true,
    }),
  );
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.integrationConnections).values(
    integrationConnectionRow({
      id: input.connectionId,
      organizationId: input.organizationId,
      targetKey: input.targetKey,
      displayName: "Designer Launch Operation Connection",
      status: IntegrationConnectionStatuses.ACTIVE,
      config: {
        connection_method: IntegrationConnectionMethodIds.API_KEY,
      },
    }),
  );
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.sandboxProfiles).values(
    sandboxProfileRow({
      id: input.profileId,
      organizationId: input.organizationId,
      displayName: "Designer Launch Operation",
      createdAt: "2026-06-18T02:29:00.000Z",
    }),
  );
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.sandboxProfileVersions).values(
    sandboxProfileVersionRow({
      sandboxProfileId: input.profileId,
      version: 1,
      state: SandboxProfileVersionStates.DRAFT,
      sandboxProvider: SandboxProvider.DOCKER,
      sandboxConnectionId: null,
      sandboxVcpuCount: null,
      sandboxMemoryMb: null,
      sandboxDiskMb: null,
      agentRuntimeId: "codex",
    }),
  );
  await input.env.controlPlaneDb
    .insert(input.env.controlPlaneTables.sandboxProfileVersionIntegrationBindings)
    .values(
      sandboxProfileVersionIntegrationBindingRow({
        id: input.bindingId,
        sandboxProfileId: input.profileId,
        sandboxProfileVersion: 1,
        connectionId: input.connectionId,
        kind: IntegrationBindingKinds.AGENT,
        config: {},
      }),
    );
}

function clientFor(env: IntegrationTestEnvironment): DataPlaneSandboxInstancesClient {
  return createDataPlaneSandboxInstancesClient({
    baseUrl: env.dataPlaneApi.hostBaseUrl,
    serviceToken: InternalServiceToken,
    testEnvironmentId: env.id,
    testEnvironmentIdHeader: TestEnvironmentIdHeader,
  });
}

function completeDesignerActionRequestExecution(
  env: IntegrationTestEnvironment,
  input: Omit<Parameters<typeof completeApprovedDesignerActionRequestExecution>[0], "ctx">,
) {
  return completeApprovedDesignerActionRequestExecution({
    ctx: {
      db: env.controlPlaneDb,
      cache: new Cache({ adapter: new InMemoryCacheAdapter() }),
      dataPlaneClient: clientFor(env),
      integrationsConfig: DesignerOperationIntegrationsConfig,
      integrationRegistry: createIntegrationRegistry(),
      mcpConfig: DesignerOperationMcpConfig,
      sandboxConfig: DesignerOperationSandboxConfig,
    },
    ...input,
  });
}
