import {
  ConversationOwnerKinds,
  ConversationRouteStatuses,
  ConversationStatuses,
  conversations,
  conversationRoutes,
  integrationConnections,
  IntegrationConnectionStatuses,
  integrationTargets,
  sandboxProfiles,
  sandboxProfileVersionIntegrationBindings,
  sandboxProfileVersions,
} from "@mistle/db/control-plane";
import { describe, expect } from "vitest";

import { it } from "./test-context.js";

describe("sandbox conversation sessions integration", () => {
  it("returns 404 when starting session for a missing sandbox profile", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-conversations-missing-profile@example.com",
    });

    const response = await fixture.request("/v1/sandbox/conversations/sessions", {
      method: "POST",
      headers: {
        cookie: authenticatedSession.cookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        profileId: "sbp_missing_profile_for_conversation_session",
        profileVersion: 1,
        integrationBindingId: "ibd_missing_profile_for_conversation_session",
      }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: "PROFILE_NOT_FOUND",
    });
  });

  it("returns 400 when integration binding does not belong to requested profile version", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-conversations-binding-mismatch@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values({
      id: "sbp_conversation_session_primary",
      organizationId: authenticatedSession.organizationId,
      displayName: "Primary Profile",
      status: "active",
    });
    await fixture.db.insert(sandboxProfileVersions).values({
      sandboxProfileId: "sbp_conversation_session_primary",
      version: 1,
    });

    await fixture.db.insert(sandboxProfiles).values({
      id: "sbp_conversation_session_other",
      organizationId: authenticatedSession.organizationId,
      displayName: "Other Profile",
      status: "active",
    });
    await fixture.db.insert(sandboxProfileVersions).values({
      sandboxProfileId: "sbp_conversation_session_other",
      version: 2,
    });
    await fixture.db.insert(integrationTargets).values({
      targetKey: "openai-conversation-session-mismatch",
      familyId: "openai",
      variantId: "openai-default",
      enabled: true,
      config: {
        api_base_url: "https://api.openai.com/v1",
      },
    });
    await fixture.db.insert(integrationConnections).values({
      id: "icn_conversation_session_other",
      organizationId: authenticatedSession.organizationId,
      targetKey: "openai-conversation-session-mismatch",
      displayName: "Mismatch connection",
      status: IntegrationConnectionStatuses.ACTIVE,
    });
    await fixture.db.insert(sandboxProfileVersionIntegrationBindings).values({
      id: "ibd_conversation_session_other",
      sandboxProfileId: "sbp_conversation_session_other",
      sandboxProfileVersion: 2,
      connectionId: "icn_conversation_session_other",
      kind: "agent",
      config: {
        runtime: "codex-cli",
      },
    });

    const response = await fixture.request("/v1/sandbox/conversations/sessions", {
      method: "POST",
      headers: {
        cookie: authenticatedSession.cookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        profileId: "sbp_conversation_session_primary",
        profileVersion: 1,
        integrationBindingId: "ibd_conversation_session_other",
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "INTEGRATION_BINDING_PROFILE_MISMATCH",
    });
  });

  it("returns 400 when integration binding config does not include a default model", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-conversations-binding-invalid-model@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values({
      id: "sbp_conversation_session_invalid_binding",
      organizationId: authenticatedSession.organizationId,
      displayName: "Invalid Binding Profile",
      status: "active",
    });
    await fixture.db.insert(sandboxProfileVersions).values({
      sandboxProfileId: "sbp_conversation_session_invalid_binding",
      version: 1,
    });
    await fixture.db.insert(integrationTargets).values({
      targetKey: "openai-conversation-session-invalid-binding",
      familyId: "openai",
      variantId: "openai-default",
      enabled: true,
      config: {
        api_base_url: "https://api.openai.com/v1",
      },
    });
    await fixture.db.insert(integrationConnections).values({
      id: "icn_conversation_session_invalid_binding",
      organizationId: authenticatedSession.organizationId,
      targetKey: "openai-conversation-session-invalid-binding",
      displayName: "Invalid binding connection",
      status: IntegrationConnectionStatuses.ACTIVE,
    });
    await fixture.db.insert(sandboxProfileVersionIntegrationBindings).values({
      id: "ibd_conversation_session_invalid_binding",
      sandboxProfileId: "sbp_conversation_session_invalid_binding",
      sandboxProfileVersion: 1,
      connectionId: "icn_conversation_session_invalid_binding",
      kind: "agent",
      config: {
        runtime: "codex-cli",
      },
    });

    const response = await fixture.request("/v1/sandbox/conversations/sessions", {
      method: "POST",
      headers: {
        cookie: authenticatedSession.cookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        profileId: "sbp_conversation_session_invalid_binding",
        profileVersion: 1,
        integrationBindingId: "ibd_conversation_session_invalid_binding",
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "INTEGRATION_BINDING_INVALID",
    });
  });

  it("returns 400 when integration binding kind is not agent", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-conversations-binding-kind-invalid@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values({
      id: "sbp_conversation_session_non_agent_binding",
      organizationId: authenticatedSession.organizationId,
      displayName: "Non-Agent Binding Profile",
      status: "active",
    });
    await fixture.db.insert(sandboxProfileVersions).values({
      sandboxProfileId: "sbp_conversation_session_non_agent_binding",
      version: 1,
    });
    await fixture.db.insert(integrationTargets).values({
      targetKey: "openai-conversation-session-non-agent-binding",
      familyId: "openai",
      variantId: "openai-default",
      enabled: true,
      config: {
        api_base_url: "https://api.openai.com/v1",
      },
    });
    await fixture.db.insert(integrationConnections).values({
      id: "icn_conversation_session_non_agent_binding",
      organizationId: authenticatedSession.organizationId,
      targetKey: "openai-conversation-session-non-agent-binding",
      displayName: "Non-agent binding connection",
      status: IntegrationConnectionStatuses.ACTIVE,
    });
    await fixture.db.insert(sandboxProfileVersionIntegrationBindings).values({
      id: "ibd_conversation_session_non_agent_binding",
      sandboxProfileId: "sbp_conversation_session_non_agent_binding",
      sandboxProfileVersion: 1,
      connectionId: "icn_conversation_session_non_agent_binding",
      kind: "git",
      config: {
        defaultModel: "gpt-5.3-codex",
      },
    });

    const response = await fixture.request("/v1/sandbox/conversations/sessions", {
      method: "POST",
      headers: {
        cookie: authenticatedSession.cookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        profileId: "sbp_conversation_session_non_agent_binding",
        profileVersion: 1,
        integrationBindingId: "ibd_conversation_session_non_agent_binding",
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "INTEGRATION_BINDING_INVALID",
    });
  });

  it("returns 404 when continuing a missing conversation id", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-conversations-missing-conversation@example.com",
    });

    const response = await fixture.request("/v1/sandbox/conversations/cnv_missing/sessions", {
      method: "POST",
      headers: {
        cookie: authenticatedSession.cookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: "CONVERSATION_NOT_FOUND",
    });
  });

  it("returns 409 when continuing a closed conversation", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-sandbox-conversations-closed@example.com",
    });

    await fixture.db.insert(sandboxProfiles).values({
      id: "sbp_conversation_closed",
      organizationId: authenticatedSession.organizationId,
      displayName: "Closed Conversation Profile",
      status: "active",
    });
    await fixture.db.insert(conversations).values({
      id: "cnv_conversation_closed",
      organizationId: authenticatedSession.organizationId,
      ownerKind: ConversationOwnerKinds.INTEGRATION_BINDING,
      ownerId: "ibd_conversation_closed",
      createdByKind: "user",
      createdById: authenticatedSession.userId,
      sandboxProfileId: "sbp_conversation_closed",
      providerFamily: "codex",
      conversationKey: "cnv_conversation_closed",
      title: null,
      preview: null,
      status: ConversationStatuses.CLOSED,
    });
    await fixture.db.insert(conversationRoutes).values({
      conversationId: "cnv_conversation_closed",
      sandboxInstanceId: "sbi_conversation_closed",
      providerConversationId: null,
      providerExecutionId: null,
      providerState: null,
      status: ConversationRouteStatuses.ACTIVE,
    });

    const response = await fixture.request(
      "/v1/sandbox/conversations/cnv_conversation_closed/sessions",
      {
        method: "POST",
        headers: {
          cookie: authenticatedSession.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "conversation_closed",
    });
  });
});
