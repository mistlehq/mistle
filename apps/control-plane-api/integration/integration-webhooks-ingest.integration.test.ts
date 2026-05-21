/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { createHmac, generateKeyPairSync } from "node:crypto";

import {
  MemberRoles,
  OrganizationIdentityLinkProviderConfigStatus,
  UserExternalPrincipalKeyStatuses,
  UserExternalPrincipalStatuses,
} from "@mistle/db/control-plane";
import { SlackConnectionMethodIds } from "@mistle/integrations-definitions";
import {
  createIntegrationTest,
  type IntegrationAuthenticatedSession,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { HandleIntegrationWebhookEventWorkflowSpec } from "@mistle/workflow-registry/control-plane";
import { eq } from "drizzle-orm";
import { describe, expect } from "vitest";

import { CreatedFormIntegrationConnectionSchema } from "../src/integration-connections/schemas.js";
import {
  IngestIntegrationWebhookResponseSchema,
  IntegrationWebhooksBadRequestResponseSchema,
} from "../src/integration-webhooks/index.js";
import { waitForQueuedControlPlaneWorkflowInput } from "./helpers/control-plane-workflows.js";
import { createFormConnection, seedIntegrationTarget } from "./helpers/integration-connections.js";

const GitHubEventTypeHeader = "issue_comment";
const InstallationId = "123456";
const SlackAppId = "A0123456789";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("integration webhooks ingest integration", () => {
  it("accepts a valid GitHub webhook, stores the event, and schedules handling", async ({
    env,
  }) => {
    const targetKey = "github-cloud-webhook-ingest-new-success";
    const webhookSecret = "whsec_test_valid";
    const externalDeliveryId = "delivery_new_success_1";
    await seedGitHubTarget(env, targetKey);
    const { connectionId, endpointKey, organizationId } = await createGitHubWebhookConnection({
      env,
      targetKey,
      email: "integration-new-webhooks-ingest-success@example.com",
      displayName: "Webhook ingest connection",
      installationId: InstallationId,
      webhookSecret,
    });

    const payloadObject = createGitHubWebhookPayload();
    const payload = JSON.stringify(payloadObject);
    const response = await postGitHubWebhook({
      env,
      targetKey,
      endpointKey,
      payload,
      externalDeliveryId,
      signatureSecret: webhookSecret,
    });

    expect(response.status).toBe(202);
    expect(IngestIntegrationWebhookResponseSchema.parse(await response.json())).toEqual({
      status: "received",
    });

    const persistedEvent = await env.controlPlaneDb.query.integrationWebhookEvents.findFirst({
      where: (table, { and, eq }) =>
        and(eq(table.targetKey, targetKey), eq(table.externalEventId, externalDeliveryId)),
    });
    if (persistedEvent === undefined) {
      throw new Error("Expected GitHub webhook event to be stored.");
    }

    expect(persistedEvent.providerEventType).toBe("issue_comment");
    expect(persistedEvent.eventType).toBe("github.issue_comment.created");
    expect(persistedEvent.status).toBe("received");
    expect(persistedEvent.organizationId).toBe(organizationId);
    expect(persistedEvent.integrationConnectionId).toBe(connectionId);
    expect(persistedEvent.payload).toEqual(payloadObject);
    expect(new Date(String(persistedEvent.sourceOccurredAt)).toISOString()).toBe(
      "2026-03-10T00:00:00.000Z",
    );
    expect(persistedEvent.sourceOrderKey).toBe("2026-03-10T00:00:00Z#00000000000000001001");

    const persistedSource = await env.controlPlaneDb.query.integrationWebhookSources.findFirst({
      where: (table, { and, eq }) =>
        and(eq(table.targetKey, targetKey), eq(table.integrationConnectionId, connectionId)),
    });
    if (persistedSource === undefined) {
      throw new Error("Expected GitHub implicit webhook source.");
    }
    expect(persistedEvent.integrationWebhookSourceId).toBe(persistedSource.id);

    await expect(
      waitForQueuedControlPlaneWorkflowInput({
        env,
        workflowName: HandleIntegrationWebhookEventWorkflowSpec.name,
        inputEquals: {
          webhookEventId: persistedEvent.id,
        },
      }),
    ).resolves.toMatchObject({
      webhookEventId: persistedEvent.id,
    });
  });

  it("rejects GitHub webhooks when signature verification fails", async ({ env }) => {
    const targetKey = "github-cloud-webhook-ingest-new-invalid-signature";
    const externalDeliveryId = "delivery_new_invalid_signature_1";
    const webhookSecret = "whsec_expected_secret";
    await seedGitHubTarget(env, targetKey);
    const { endpointKey } = await createGitHubWebhookConnection({
      env,
      targetKey,
      email: "integration-new-webhooks-ingest-invalid-signature@example.com",
      displayName: "Invalid signature connection",
      installationId: InstallationId,
      webhookSecret,
    });

    const payload = JSON.stringify(createGitHubWebhookPayload());
    const response = await postGitHubWebhook({
      env,
      targetKey,
      endpointKey,
      payload,
      externalDeliveryId,
      signatureSecret: "whsec_wrong_secret",
    });

    expect(response.status).toBe(400);
    const body = IntegrationWebhooksBadRequestResponseSchema.parse(await response.json());
    expect(body.code).toBe("INVALID_WEBHOOK_REQUEST");
    await expect(
      env.controlPlaneDb.query.integrationWebhookEvents.findFirst({
        where: (table, { and, eq }) =>
          and(eq(table.targetKey, targetKey), eq(table.externalEventId, externalDeliveryId)),
      }),
    ).resolves.toBeUndefined();
  });

  it("returns duplicate for repeated GitHub delivery ids and stores one event", async ({ env }) => {
    const targetKey = "github-cloud-webhook-ingest-new-duplicate";
    const externalDeliveryId = "delivery_new_duplicate_1";
    const webhookSecret = "whsec_duplicate_secret";
    await seedGitHubTarget(env, targetKey);
    const { endpointKey } = await createGitHubWebhookConnection({
      env,
      targetKey,
      email: "integration-new-webhooks-ingest-duplicate@example.com",
      displayName: "Duplicate webhook connection",
      installationId: InstallationId,
      webhookSecret,
    });

    const payload = JSON.stringify(createGitHubWebhookPayload());
    const firstResponse = await postGitHubWebhook({
      env,
      targetKey,
      endpointKey,
      payload,
      externalDeliveryId,
      signatureSecret: webhookSecret,
    });
    expect(firstResponse.status).toBe(202);
    expect(IngestIntegrationWebhookResponseSchema.parse(await firstResponse.json())).toEqual({
      status: "received",
    });

    const secondResponse = await postGitHubWebhook({
      env,
      targetKey,
      endpointKey,
      payload,
      externalDeliveryId,
      signatureSecret: webhookSecret,
    });
    expect(secondResponse.status).toBe(202);
    expect(IngestIntegrationWebhookResponseSchema.parse(await secondResponse.json())).toEqual({
      status: "duplicate",
    });

    const persistedEvents = await env.controlPlaneDb.query.integrationWebhookEvents.findMany({
      where: (table, { and, eq }) =>
        and(eq(table.targetKey, targetKey), eq(table.externalEventId, externalDeliveryId)),
    });
    expect(persistedEvents).toHaveLength(1);
  });

  it("returns Slack URL verification challenges without storing webhook events", async ({
    env,
  }) => {
    await seedSlackTarget(env);
    const challenge = "challenge-value";
    const { endpointKey } = await createSlackWebhookConnection({
      env,
      email: "integration-new-webhooks-ingest-slack-url-verification@example.com",
      signingSecret: "slack-signing-secret",
    });

    const response = await postSlackUrlVerification({
      env,
      endpointKey,
      signingSecret: "slack-signing-secret",
      challenge,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain");
    await expect(response.text()).resolves.toBe(challenge);
    await expect(
      env.controlPlaneDb.query.integrationWebhookEvents.findMany({
        where: (table, { eq }) => eq(table.targetKey, "slack-default"),
      }),
    ).resolves.toEqual([]);
  });

  it("rejects Slack URL verification challenges when signature verification fails", async ({
    env,
  }) => {
    await seedSlackTarget(env);
    const { endpointKey } = await createSlackWebhookConnection({
      env,
      email: "integration-new-webhooks-ingest-slack-url-verification-invalid@example.com",
      signingSecret: "slack-signing-secret",
    });

    const response = await postSlackUrlVerification({
      env,
      endpointKey,
      signingSecret: "wrong-slack-signing-secret",
      challenge: "challenge-value",
    });

    expect(response.status).toBe(400);
    const body = IntegrationWebhooksBadRequestResponseSchema.parse(await response.json());
    expect(body.code).toBe("INVALID_WEBHOOK_REQUEST");
    await expect(
      env.controlPlaneDb.query.integrationWebhookEvents.findMany({
        where: (table, { eq }) => eq(table.targetKey, "slack-default"),
      }),
    ).resolves.toEqual([]);
  });

  it("resolves Slack webhook actors through the matching provider config connection", async ({
    env,
  }) => {
    await seedSlackTarget(env);
    const ownerSession = await env.auth.createSession({
      email: "integration-new-webhooks-ingest-slack-actor-owner@example.com",
    });
    const memberSession = await env.auth.createSession({
      email: "integration-new-webhooks-ingest-slack-actor-member@example.com",
    });
    await addMemberToOrganization(env, {
      organizationId: ownerSession.organizationId,
      userId: memberSession.userId,
      role: MemberRoles.MEMBER,
    });

    const connectionA = await createSlackWebhookConnection({
      env,
      session: ownerSession,
      email: "integration-new-webhooks-ingest-slack-actor-owner@example.com",
      signingSecret: "slack-signing-secret-a",
    });
    const connectionB = await createSlackWebhookConnection({
      env,
      session: ownerSession,
      email: "integration-new-webhooks-ingest-slack-actor-owner@example.com",
      signingSecret: "slack-signing-secret-b",
    });
    await seedSlackIdentityLinkConfig(env, {
      configId: "ilp_webhook_actor_slack_a",
      connectionId: connectionA.connectionId,
      organizationId: ownerSession.organizationId,
      userId: ownerSession.userId,
    });
    await seedSlackIdentityLinkConfig(env, {
      configId: "ilp_webhook_actor_slack_b",
      connectionId: connectionB.connectionId,
      organizationId: ownerSession.organizationId,
      userId: ownerSession.userId,
    });
    await seedSlackLinkedPrincipal(env, {
      principalId: "uep_webhook_actor_slack_a",
      organizationId: ownerSession.organizationId,
      userId: ownerSession.userId,
      providerConfigId: "ilp_webhook_actor_slack_a",
      connectionId: connectionA.connectionId,
      workspaceId: "T_WORKSPACE_A",
      userKey: "U_SHARED",
    });
    await seedSlackLinkedPrincipal(env, {
      principalId: "uep_webhook_actor_slack_b",
      organizationId: ownerSession.organizationId,
      userId: memberSession.userId,
      providerConfigId: "ilp_webhook_actor_slack_b",
      connectionId: connectionB.connectionId,
      workspaceId: "T_WORKSPACE_B",
      userKey: "U_SHARED",
    });

    await expect(
      postSlackEvent({
        env,
        endpointKey: connectionA.endpointKey,
        signingSecret: "slack-signing-secret-a",
        externalEventId: "Ev_webhook_actor_slack_a",
        workspaceId: "T_WORKSPACE_A",
        userKey: "U_SHARED",
      }),
    ).resolves.toHaveProperty("status", 202);
    await expect(
      postSlackEvent({
        env,
        endpointKey: connectionB.endpointKey,
        signingSecret: "slack-signing-secret-b",
        externalEventId: "Ev_webhook_actor_slack_b",
        workspaceId: "T_WORKSPACE_B",
        userKey: "U_SHARED",
      }),
    ).resolves.toHaveProperty("status", 202);
    await expect(
      postSlackEvent({
        env,
        endpointKey: connectionA.endpointKey,
        signingSecret: "slack-signing-secret-a",
        externalEventId: "Ev_webhook_actor_slack_wrong_workspace",
        workspaceId: "T_WORKSPACE_B",
        userKey: "U_SHARED",
      }),
    ).resolves.toHaveProperty("status", 202);

    await expect(readSlackWebhookResolution(env, "Ev_webhook_actor_slack_a")).resolves.toEqual({
      integrationConnectionId: connectionA.connectionId,
      resolvedPrincipalId: "uep_webhook_actor_slack_a",
      resolvedUserId: ownerSession.userId,
    });
    await expect(readSlackWebhookResolution(env, "Ev_webhook_actor_slack_b")).resolves.toEqual({
      integrationConnectionId: connectionB.connectionId,
      resolvedPrincipalId: "uep_webhook_actor_slack_b",
      resolvedUserId: memberSession.userId,
    });
    await expect(
      readSlackWebhookResolution(env, "Ev_webhook_actor_slack_wrong_workspace"),
    ).resolves.toEqual({
      integrationConnectionId: connectionA.connectionId,
      resolvedPrincipalId: null,
      resolvedUserId: null,
    });
  });
});

function createSlackEventPayload(input: {
  externalEventId: string;
  workspaceId: string;
  userKey: string;
}): string {
  return JSON.stringify({
    token: "verification-token",
    team_id: input.workspaceId,
    api_app_id: SlackAppId,
    event: {
      type: "message",
      user: input.userKey,
      text: "Hello from Slack",
      channel: "C12345",
      event_ts: "1760000000.000100",
      ts: "1760000000.000100",
    },
    type: "event_callback",
    event_id: input.externalEventId,
    event_time: 1_760_000_000,
  });
}

function createSlackUrlVerificationPayload(input: { challenge: string }): string {
  return JSON.stringify({
    token: "verification-token",
    challenge: input.challenge,
    type: "url_verification",
  });
}

async function postSlackUrlVerification(input: {
  env: IntegrationTestEnvironment;
  endpointKey: string;
  signingSecret: string;
  challenge: string;
}) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const payload = createSlackUrlVerificationPayload({ challenge: input.challenge });

  return input.env.controlPlaneApi.http.fetch(
    `/p/integration/webhooks/slack-default/${input.endpointKey}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-slack-request-timestamp": timestamp,
        "x-slack-signature": signSlackWebhookPayload({
          secret: input.signingSecret,
          payload,
          timestamp,
        }),
      },
      body: payload,
    },
  );
}

async function postSlackEvent(input: {
  env: IntegrationTestEnvironment;
  endpointKey: string;
  signingSecret: string;
  externalEventId: string;
  workspaceId: string;
  userKey: string;
}) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const payload = createSlackEventPayload({
    externalEventId: input.externalEventId,
    workspaceId: input.workspaceId,
    userKey: input.userKey,
  });

  return input.env.controlPlaneApi.http.fetch(
    `/p/integration/webhooks/slack-default/${input.endpointKey}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-slack-request-timestamp": timestamp,
        "x-slack-signature": signSlackWebhookPayload({
          secret: input.signingSecret,
          payload,
          timestamp,
        }),
      },
      body: payload,
    },
  );
}

function createGitHubWebhookPayload(): Record<string, unknown> {
  return {
    action: "created",
    installation: {
      id: InstallationId,
    },
    repository: {
      id: 1,
      name: "demo",
      full_name: "mistlehq/demo",
    },
    issue: {
      number: 42,
    },
    comment: {
      id: 1001,
      body: "Hello webhook",
      created_at: "2026-03-10T00:00:00Z",
    },
  };
}

function signGitHubWebhookPayload(input: { secret: string; payload: string }): string {
  // GitHub documents X-Hub-Signature-256 as `sha256=` plus HMAC-SHA256 over the raw body.
  // https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries
  const digest = createHmac("sha256", input.secret).update(input.payload, "utf8").digest("hex");
  return `sha256=${digest}`;
}

function signSlackWebhookPayload(input: {
  secret: string;
  payload: string;
  timestamp: string;
}): string {
  // Slack signs `v0:<timestamp>:<body>` with the app signing secret.
  // https://api.slack.com/docs/verifying-requests-from-slack
  const digest = createHmac("sha256", input.secret)
    .update(`v0:${input.timestamp}:${input.payload}`, "utf8")
    .digest("hex");
  return `v0=${digest}`;
}

async function seedGitHubTarget(env: IntegrationTestEnvironment, targetKey: string): Promise<void> {
  await seedIntegrationTarget(env, {
    targetKey,
    familyId: "github",
    variantId: "github-cloud",
    config: {
      api_base_url: "https://api.github.com",
      web_base_url: "https://github.com",
    },
  });
}

async function seedSlackTarget(env: IntegrationTestEnvironment): Promise<void> {
  await seedIntegrationTarget(env, {
    targetKey: "slack-default",
    familyId: "slack",
    variantId: "slack-default",
    config: {
      api_base_url: "https://slack.com/api",
    },
  });
}

async function createGitHubWebhookConnection(input: {
  env: IntegrationTestEnvironment;
  targetKey: string;
  email: string;
  displayName: string;
  installationId: string;
  webhookSecret: string;
}): Promise<{
  connectionId: string;
  endpointKey: string;
  organizationId: string;
}> {
  const session = await input.env.auth.createSession({
    email: input.email,
  });
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: {
      type: "pkcs8",
      format: "pem",
    },
    publicKeyEncoding: {
      type: "spki",
      format: "pem",
    },
  });
  const createResponse = await createFormConnection({
    env: input.env,
    targetKey: input.targetKey,
    cookie: session.cookie,
    body: {
      displayName: input.displayName,
      methodId: "github-app-installation",
      config: {
        connection_method: "github-app-installation",
        app_id: "123",
        app_slug: "mistle-github-app",
        client_id: "Iv1.client123",
        installation_id: input.installationId,
      },
      secrets: {
        appPrivateKeyPem: privateKey,
        clientSecret: "github-client-secret",
        webhookSecret: input.webhookSecret,
      },
    },
  });
  expect(createResponse.status).toBe(201);
  const connection = CreatedFormIntegrationConnectionSchema.parse(await createResponse.json());

  await input.env.controlPlaneDb
    .update(input.env.controlPlaneTables.integrationConnections)
    .set({
      externalSubjectId: input.installationId,
    })
    .where(eq(input.env.controlPlaneTables.integrationConnections.id, connection.id));

  const webhookSource = await input.env.controlPlaneDb.query.integrationWebhookSources.findFirst({
    where: (table, { and, eq }) =>
      and(eq(table.targetKey, input.targetKey), eq(table.integrationConnectionId, connection.id)),
  });
  if (webhookSource?.endpointKey === undefined || webhookSource.endpointKey === null) {
    throw new Error("Expected persisted GitHub webhook source endpoint key.");
  }

  return {
    connectionId: connection.id,
    endpointKey: webhookSource.endpointKey,
    organizationId: session.organizationId,
  };
}

async function createSlackWebhookConnection(input: {
  env: IntegrationTestEnvironment;
  email: string;
  signingSecret: string;
  session?: IntegrationAuthenticatedSession;
}): Promise<{ connectionId: string; endpointKey: string; organizationId: string }> {
  const session =
    input.session ??
    (await input.env.auth.createSession({
      email: input.email,
    }));
  const response = await createFormConnection({
    env: input.env,
    targetKey: "slack-default",
    cookie: session.cookie,
    body: {
      displayName: "Slack Events API",
      methodId: SlackConnectionMethodIds.SLACK_APP,
      config: {
        connection_method: SlackConnectionMethodIds.SLACK_APP,
        app_id: SlackAppId,
      },
      secrets: {
        botToken: "xoxb-test-bot-token",
        signingSecret: input.signingSecret,
        clientSecret: "slack-client-secret",
      },
    },
  });
  expect(response.status).toBe(201);
  const connection = CreatedFormIntegrationConnectionSchema.parse(await response.json());

  const webhookSource = await input.env.controlPlaneDb.query.integrationWebhookSources.findFirst({
    where: (table, { and, eq }) =>
      and(eq(table.integrationConnectionId, connection.id), eq(table.targetKey, "slack-default")),
  });
  if (webhookSource?.endpointKey === undefined || webhookSource.endpointKey === null) {
    throw new Error("Expected persisted Slack webhook source endpoint key.");
  }

  return {
    connectionId: connection.id,
    endpointKey: webhookSource.endpointKey,
    organizationId: session.organizationId,
  };
}

async function addMemberToOrganization(
  env: IntegrationTestEnvironment,
  input: {
    organizationId: string;
    userId: string;
    role: (typeof MemberRoles)[keyof typeof MemberRoles];
  },
): Promise<void> {
  await env.controlPlaneDb.insert(env.controlPlaneTables.members).values({
    organizationId: input.organizationId,
    userId: input.userId,
    role: input.role,
  });

  await env.controlPlaneDb
    .update(env.controlPlaneTables.sessions)
    .set({
      activeOrganizationId: input.organizationId,
    })
    .where(eq(env.controlPlaneTables.sessions.userId, input.userId));
}

async function seedSlackIdentityLinkConfig(
  env: IntegrationTestEnvironment,
  input: {
    configId: string;
    connectionId: string;
    organizationId: string;
    userId: string;
  },
): Promise<void> {
  await env.controlPlaneDb
    .insert(env.controlPlaneTables.organizationIdentityLinkProviderConfigs)
    .values({
      id: input.configId,
      organizationId: input.organizationId,
      providerFamily: "slack",
      status: OrganizationIdentityLinkProviderConfigStatus.ACTIVE,
      integrationTargetKey: "slack-default",
      integrationConnectionId: input.connectionId,
      createdByUserId: input.userId,
      updatedByUserId: input.userId,
    });
}

async function seedSlackLinkedPrincipal(
  env: IntegrationTestEnvironment,
  input: {
    principalId: string;
    organizationId: string;
    userId: string;
    providerConfigId: string;
    connectionId: string;
    workspaceId: string;
    userKey: string;
  },
): Promise<void> {
  await env.controlPlaneDb.insert(env.controlPlaneTables.userExternalPrincipals).values({
    id: input.principalId,
    organizationId: input.organizationId,
    userId: input.userId,
    providerFamily: "slack",
    providerSubjectId: `${input.workspaceId}:${input.userKey}`,
    organizationProviderConfigId: input.providerConfigId,
    integrationConnectionId: input.connectionId,
    status: UserExternalPrincipalStatuses.ACTIVE,
    profile: {
      workspaceId: input.workspaceId,
      displayName: "Shared Slack User",
    },
  });
  await env.controlPlaneDb.insert(env.controlPlaneTables.userExternalPrincipalKeys).values([
    {
      organizationId: input.organizationId,
      principalId: input.principalId,
      providerFamily: "slack",
      keyType: "workspace_id",
      keyValue: input.workspaceId,
      status: UserExternalPrincipalKeyStatuses.ACTIVE,
    },
    {
      organizationId: input.organizationId,
      principalId: input.principalId,
      providerFamily: "slack",
      keyType: "user_id",
      keyValue: input.userKey,
      status: UserExternalPrincipalKeyStatuses.ACTIVE,
    },
  ]);
}

async function readSlackWebhookResolution(
  env: IntegrationTestEnvironment,
  externalEventId: string,
): Promise<{
  integrationConnectionId: string;
  resolvedPrincipalId: string | null;
  resolvedUserId: string | null;
}> {
  const event = await env.controlPlaneDb.query.integrationWebhookEvents.findFirst({
    where: (table, { and, eq }) =>
      and(eq(table.targetKey, "slack-default"), eq(table.externalEventId, externalEventId)),
  });
  if (event === undefined) {
    throw new Error(`Expected Slack webhook event '${externalEventId}' to be stored.`);
  }

  return {
    integrationConnectionId: event.integrationConnectionId,
    resolvedPrincipalId: event.resolvedPrincipalId,
    resolvedUserId: event.resolvedUserId,
  };
}

async function postGitHubWebhook(input: {
  env: IntegrationTestEnvironment;
  targetKey: string;
  endpointKey: string;
  payload: string;
  externalDeliveryId: string;
  signatureSecret: string;
}) {
  return input.env.controlPlaneApi.http.fetch(
    `/p/integration/webhooks/${input.targetKey}/${input.endpointKey}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": GitHubEventTypeHeader,
        "x-github-delivery": input.externalDeliveryId,
        "x-hub-signature-256": signGitHubWebhookPayload({
          secret: input.signatureSecret,
          payload: input.payload,
        }),
      },
      body: input.payload,
    },
  );
}
