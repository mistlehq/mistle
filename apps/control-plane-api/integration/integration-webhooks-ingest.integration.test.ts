import { createHmac } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";

import {
  integrationConnectionCredentials,
  integrationConnections,
  integrationCredentials,
  IntegrationConnectionStatuses,
  IntegrationCredentialSecretKinds,
  integrationTargets,
  integrationWebhookSources,
  IntegrationWebhookSourceStatuses,
} from "@mistle/db/control-plane";
import { reserveAvailablePort } from "@mistle/test-harness";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { describe, expect } from "vitest";

import { IntegrationConnectionSchema } from "../src/integration-connections/schemas.js";
import {
  IngestIntegrationWebhookResponseSchema,
  IntegrationWebhooksBadRequestResponseSchema,
} from "../src/integration-webhooks/index.js";
import {
  encryptCredentialUtf8,
  resolveMasterEncryptionKeyMaterial,
  unwrapOrganizationCredentialKey,
} from "../src/lib/crypto.js";
import { ControlPlaneOpenWorkflowSchema } from "../src/openworkflow.js";
import { it } from "./test-context.js";
import type { ControlPlaneApiIntegrationFixture } from "./test-context.js";

const GitHubEventTypeHeader = "issue_comment";
const InstallationId = "123456";
const ControlPlaneWorkflowNamespaceId = "integration";
const HandleIntegrationWebhookEventWorkflowName = "control-plane.integration-webhooks.handle-event";
const SlackThreadRootTimestampField = "mistle_thread_root_ts";

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
  const digest = createHmac("sha256", input.secret).update(input.payload, "utf8").digest("hex");
  return `sha256=${digest}`;
}

async function ensureGitHubTarget(input: {
  fixture: ControlPlaneApiIntegrationFixture;
  targetKey: string;
}): Promise<void> {
  await input.fixture.db.insert(integrationTargets).values({
    targetKey: input.targetKey,
    familyId: "github",
    variantId: "github-cloud",
    enabled: true,
    config: {
      api_base_url: "https://api.github.com",
      web_base_url: "https://github.com",
    },
  });
}

async function createGitHubWebhookConnection(input: {
  fixture: ControlPlaneApiIntegrationFixture;
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
  const authenticatedSession = await input.fixture.authSession({
    email: input.email,
  });
  const createConnectionResponse = await input.fixture.request(
    `/v1/integration/connections/${input.targetKey}/form`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: authenticatedSession.cookie,
      },
      body: JSON.stringify({
        displayName: input.displayName,
        methodId: "github-app-installation",
        config: {
          connection_method: "github-app-installation",
          app_id: "123",
          app_slug: "mistle-github-app",
          installation_id: input.installationId,
        },
        secrets: {
          appPrivateKeyPem: "-----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----",
          webhookSecret: input.webhookSecret,
        },
      }),
    },
  );
  expect(createConnectionResponse.status).toBe(201);
  const connection = IntegrationConnectionSchema.parse(await createConnectionResponse.json());

  await input.fixture.db
    .update(integrationConnections)
    .set({
      externalSubjectId: input.installationId,
    })
    .where(eq(integrationConnections.id, connection.id));

  const persistedWebhookSource = await input.fixture.db.query.integrationWebhookSources.findFirst({
    where: (table, { and, eq }) =>
      and(eq(table.targetKey, input.targetKey), eq(table.integrationConnectionId, connection.id)),
  });

  if (
    persistedWebhookSource?.endpointKey === undefined ||
    persistedWebhookSource.endpointKey === null
  ) {
    throw new Error("Expected persisted GitHub webhook source endpoint key.");
  }

  return {
    connectionId: connection.id,
    endpointKey: persistedWebhookSource.endpointKey,
    organizationId: authenticatedSession.organizationId,
  };
}

function createJiraWebhookPayload(input: { siteUrl: string }): Record<string, unknown> {
  return {
    timestamp: 1_775_151_763_000,
    webhookEvent: "jira:issue_created",
    issue_event_type_name: "issue_created",
    issue: {
      id: "10001",
      self: `${input.siteUrl}/rest/api/2/issue/10001`,
      key: "MST-101",
    },
    user: {
      accountId: "jira-user-123",
    },
  };
}

function signJiraWebhookPayload(input: { secret: string; payload: string }): string {
  const digest = createHmac("sha256", input.secret).update(input.payload, "utf8").digest("hex");
  return `sha256=${digest}`;
}

function createSlackMessageWebhookPayload(): Record<string, unknown> {
  return {
    token: "verification-token",
    team_id: "T123",
    api_app_id: "A123",
    event: createSlackMessageEventPayload(),
    type: "event_callback",
    event_id: "Ev123",
    event_time: 1_710_000_000,
    authed_users: ["U999"],
  };
}
function createSlackMessageEventPayload(): Record<string, unknown> {
  return {
    type: "message",
    channel: "C123",
    user: "U123",
    text: "Hello from Slack",
    ts: "1710000000.000100",
    event_ts: "1710000000.000100",
  };
}

function createSlackMessageDeletedWebhookPayload(): Record<string, unknown> {
  return {
    ...createSlackMessageWebhookPayload(),
    event: {
      ...createSlackMessageEventPayload(),
      hidden: true,
      subtype: "message_deleted",
      deleted_ts: "1710000000.000100",
      previous_message: {
        type: "message",
        user: "U123",
        text: "Hello from Slack",
        ts: "1710000000.000100",
      },
    },
    event_id: "Ev124",
  };
}

function createSlackReactionWebhookPayload(): Record<string, unknown> {
  return {
    ...createSlackMessageWebhookPayload(),
    event: createSlackReactionEventPayload(),
    event_id: "Ev125",
  };
}

function createSlackReactionEventPayload(): Record<string, unknown> {
  return {
    type: "reaction_added",
    user: "U123",
    reaction: "thumbsup",
    item: {
      type: "message",
      channel: "C123",
      ts: "1710000000.000200",
    },
    event_ts: "1710000000.000300",
  };
}

function createSlackUrlVerificationPayload(): Record<string, unknown> {
  return {
    token: "verification-token",
    challenge: "challenge-value",
    type: "url_verification",
  };
}

function signSlackWebhookPayload(input: {
  secret: string;
  payload: string;
  timestamp: string;
}): string {
  const digest = createHmac("sha256", input.secret)
    .update(`v0:${input.timestamp}:${input.payload}`, "utf8")
    .digest("hex");
  return `v0=${digest}`;
}

async function createWebhookSecretCredential(input: {
  fixture: ControlPlaneApiIntegrationFixture;
  organizationId: string;
  familyId: string;
  secret: string;
}): Promise<string> {
  const organizationCredentialKey =
    await input.fixture.db.query.organizationCredentialKeys.findFirst({
      where: (table, { eq }) => eq(table.organizationId, input.organizationId),
      orderBy: (table, { desc }) => [desc(table.version)],
    });

  if (organizationCredentialKey === undefined) {
    throw new Error("Expected organization credential key.");
  }

  const masterEncryptionKeyMaterial = resolveMasterEncryptionKeyMaterial({
    masterKeyVersion: organizationCredentialKey.masterKeyVersion,
    masterEncryptionKeys: input.fixture.config.integrations.masterEncryptionKeys,
  });
  const unwrappedOrganizationCredentialKey = unwrapOrganizationCredentialKey({
    wrappedCiphertext: organizationCredentialKey.ciphertext,
    masterEncryptionKeyMaterial,
  });

  try {
    const encryptedSecret = encryptCredentialUtf8({
      plaintext: input.secret,
      organizationCredentialKey: unwrappedOrganizationCredentialKey,
    });
    const [createdCredential] = await input.fixture.db
      .insert(integrationCredentials)
      .values({
        organizationId: input.organizationId,
        secretKind: IntegrationCredentialSecretKinds.WEBHOOK_SECRET,
        ciphertext: encryptedSecret.ciphertext,
        nonce: encryptedSecret.nonce,
        organizationCredentialKeyVersion: organizationCredentialKey.version,
        intendedFamilyId: input.familyId,
      })
      .returning({
        id: integrationCredentials.id,
      });

    if (createdCredential === undefined) {
      throw new Error("Expected webhook secret credential.");
    }

    return createdCredential.id;
  } finally {
    unwrappedOrganizationCredentialKey.fill(0);
  }
}

async function createConnectionApiKeyCredential(input: {
  fixture: ControlPlaneApiIntegrationFixture;
  organizationId: string;
  familyId: string;
  connectionId: string;
  slotKey: string;
  secret: string;
}): Promise<void> {
  const organizationCredentialKey =
    await input.fixture.db.query.organizationCredentialKeys.findFirst({
      where: (table, { eq }) => eq(table.organizationId, input.organizationId),
      orderBy: (table, { desc }) => [desc(table.version)],
    });

  if (organizationCredentialKey === undefined) {
    throw new Error("Expected organization credential key.");
  }

  const masterEncryptionKeyMaterial = resolveMasterEncryptionKeyMaterial({
    masterKeyVersion: organizationCredentialKey.masterKeyVersion,
    masterEncryptionKeys: input.fixture.config.integrations.masterEncryptionKeys,
  });
  const unwrappedOrganizationCredentialKey = unwrapOrganizationCredentialKey({
    wrappedCiphertext: organizationCredentialKey.ciphertext,
    masterEncryptionKeyMaterial,
  });

  try {
    const encryptedSecret = encryptCredentialUtf8({
      plaintext: input.secret,
      organizationCredentialKey: unwrappedOrganizationCredentialKey,
    });
    const [createdCredential] = await input.fixture.db
      .insert(integrationCredentials)
      .values({
        organizationId: input.organizationId,
        secretKind: IntegrationCredentialSecretKinds.API_KEY,
        ciphertext: encryptedSecret.ciphertext,
        nonce: encryptedSecret.nonce,
        organizationCredentialKeyVersion: organizationCredentialKey.version,
        intendedFamilyId: input.familyId,
      })
      .returning({
        id: integrationCredentials.id,
      });

    if (createdCredential === undefined) {
      throw new Error("Expected API key credential.");
    }

    await input.fixture.db.insert(integrationConnectionCredentials).values({
      connectionId: input.connectionId,
      credentialId: createdCredential.id,
      slotKey: input.slotKey,
    });
  } finally {
    unwrappedOrganizationCredentialKey.fill(0);
  }
}

type PersistedWebhookWorkflowRun = {
  id: string;
  workflowName: string;
  idempotencyKey: string | null;
};

async function listWebhookWorkflowRuns(input: {
  databaseUrl: string;
  webhookEventId: string;
}): Promise<ReadonlyArray<PersistedWebhookWorkflowRun>> {
  const dbPool = new Pool({
    connectionString: input.databaseUrl,
  });

  try {
    const workflowRunRows = await dbPool.query<{
      id: string;
      workflow_name: string;
      idempotency_key: string | null;
    }>(
      `
        select
          wr.id,
          wr.workflow_name,
          wr.idempotency_key
        from ${ControlPlaneOpenWorkflowSchema}.workflow_runs wr
        where wr.namespace_id = $1
          and wr.workflow_name = $2
          and wr.input ->> 'webhookEventId' = $3
        order by wr.created_at asc
      `,
      [
        ControlPlaneWorkflowNamespaceId,
        HandleIntegrationWebhookEventWorkflowName,
        input.webhookEventId,
      ],
    );

    return workflowRunRows.rows.map((workflowRunRow) => ({
      id: workflowRunRow.id,
      workflowName: workflowRunRow.workflow_name,
      idempotencyKey: workflowRunRow.idempotency_key,
    }));
  } finally {
    await dbPool.end();
  }
}

describe("integration webhooks ingest integration", () => {
  it("accepts a valid GitHub webhook and stores the event", async ({ fixture }) => {
    const targetKey = "github-cloud-webhook-ingest-success";
    const webhookSecret = "whsec_test_valid";
    const externalDeliveryId = "delivery_success_1";
    await ensureGitHubTarget({
      fixture,
      targetKey,
    });
    const { connectionId, endpointKey, organizationId } = await createGitHubWebhookConnection({
      fixture,
      targetKey,
      email: "integration-webhooks-ingest-success@example.com",
      displayName: "Webhook ingest connection",
      installationId: InstallationId,
      webhookSecret,
    });

    const payloadObject = createGitHubWebhookPayload();
    const payload = JSON.stringify(payloadObject);
    const response = await fixture.request(`/p/integration/webhooks/${targetKey}/${endpointKey}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": GitHubEventTypeHeader,
        "x-github-delivery": externalDeliveryId,
        "x-hub-signature-256": signGitHubWebhookPayload({
          secret: webhookSecret,
          payload,
        }),
      },
      body: payload,
    });

    expect(response.status).toBe(202);
    const responseBody = IngestIntegrationWebhookResponseSchema.parse(await response.json());
    expect(responseBody).toEqual({
      status: "received",
    });

    const persistedEvent = await fixture.db.query.integrationWebhookEvents.findFirst({
      where: (table, { and, eq }) =>
        and(eq(table.targetKey, targetKey), eq(table.externalEventId, externalDeliveryId)),
    });

    expect(persistedEvent).toBeDefined();
    if (persistedEvent === undefined) {
      throw new Error("Expected webhook event to be stored.");
    }

    expect(persistedEvent.providerEventType).toBe("issue_comment");
    expect(persistedEvent.eventType).toBe("github.issue_comment.created");
    expect(persistedEvent.status).toBe("received");
    expect(persistedEvent.organizationId).toBe(organizationId);
    expect(persistedEvent.integrationConnectionId).toBe(connectionId);
    expect(persistedEvent.integrationWebhookSourceId).toBeDefined();
    expect(persistedEvent.payload).toEqual(payloadObject);
    expect(new Date(String(persistedEvent.sourceOccurredAt)).toISOString()).toBe(
      "2026-03-10T00:00:00.000Z",
    );
    expect(persistedEvent.sourceOrderKey).toBe("2026-03-10T00:00:00Z#00000000000000001001");

    const persistedSource = await fixture.db.query.integrationWebhookSources.findFirst({
      where: (table, { and, eq }) =>
        and(eq(table.targetKey, targetKey), eq(table.integrationConnectionId, connectionId)),
    });

    expect(persistedSource).toBeDefined();
    if (persistedSource === undefined) {
      throw new Error("Expected implicit connection-owned webhook source to be created.");
    }

    expect(persistedEvent.integrationWebhookSourceId).toBe(persistedSource.id);

    const workflowRuns = await listWebhookWorkflowRuns({
      databaseUrl: fixture.databaseStack.directUrl,
      webhookEventId: persistedEvent.id,
    });
    expect(workflowRuns).toHaveLength(1);
    const [workflowRun] = workflowRuns;
    if (workflowRun === undefined) {
      throw new Error("Expected webhook workflow run to be enqueued.");
    }
    expect(workflowRun.workflowName).toBe(HandleIntegrationWebhookEventWorkflowName);
    expect(workflowRun.idempotencyKey).toBe(persistedEvent.id);
  });

  it("returns 400 when webhook signature verification fails", async ({ fixture }) => {
    const targetKey = "github-cloud-webhook-ingest-invalid-signature";
    const webhookSecret = "whsec_expected_secret";
    const externalDeliveryId = "delivery_invalid_signature_1";
    await ensureGitHubTarget({
      fixture,
      targetKey,
    });
    const { endpointKey } = await createGitHubWebhookConnection({
      fixture,
      targetKey,
      email: "integration-webhooks-ingest-invalid-signature@example.com",
      displayName: "Invalid signature connection",
      installationId: InstallationId,
      webhookSecret,
    });

    const payloadObject = createGitHubWebhookPayload();
    const payload = JSON.stringify(payloadObject);
    const response = await fixture.request(`/p/integration/webhooks/${targetKey}/${endpointKey}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": GitHubEventTypeHeader,
        "x-github-delivery": externalDeliveryId,
        "x-hub-signature-256": signGitHubWebhookPayload({
          secret: "whsec_wrong_secret",
          payload,
        }),
      },
      body: payload,
    });

    expect(response.status).toBe(400);
    const responseBody = IntegrationWebhooksBadRequestResponseSchema.parse(await response.json());
    expect(responseBody.code).toBe("INVALID_WEBHOOK_REQUEST");

    const persistedEvent = await fixture.db.query.integrationWebhookEvents.findFirst({
      where: (table, { and, eq }) =>
        and(eq(table.targetKey, targetKey), eq(table.externalEventId, externalDeliveryId)),
    });
    expect(persistedEvent).toBeUndefined();
  });

  it("returns 400 when the webhook installation does not match the path-routed connection", async ({
    fixture,
  }) => {
    const targetKey = "github-cloud-webhook-ingest-installation-mismatch";
    const externalDeliveryId = "delivery_installation_mismatch_1";
    const webhookSecret = "whsec_mismatch_secret";
    await ensureGitHubTarget({
      fixture,
      targetKey,
    });
    const { endpointKey } = await createGitHubWebhookConnection({
      fixture,
      targetKey,
      email: "integration-webhooks-ingest-installation-mismatch@example.com",
      displayName: "Mismatch webhook connection",
      installationId: "999999",
      webhookSecret,
    });

    const payload = JSON.stringify(createGitHubWebhookPayload());
    const response = await fixture.request(`/p/integration/webhooks/${targetKey}/${endpointKey}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": GitHubEventTypeHeader,
        "x-github-delivery": externalDeliveryId,
        "x-hub-signature-256": signGitHubWebhookPayload({
          secret: webhookSecret,
          payload,
        }),
      },
      body: payload,
    });

    expect(response.status).toBe(400);
    const responseBody = IntegrationWebhooksBadRequestResponseSchema.parse(await response.json());
    expect(responseBody.code).toBe("INVALID_WEBHOOK_REQUEST");

    const persistedEvent = await fixture.db.query.integrationWebhookEvents.findFirst({
      where: (table, { and, eq }) =>
        and(eq(table.targetKey, targetKey), eq(table.externalEventId, externalDeliveryId)),
    });
    expect(persistedEvent).toBeUndefined();
  });

  it("returns duplicate for repeated external event ids and keeps one stored row", async ({
    fixture,
  }) => {
    const targetKey = "github-cloud-webhook-ingest-duplicate";
    const webhookSecret = "whsec_duplicate_secret";
    const externalDeliveryId = "delivery_duplicate_1";
    await ensureGitHubTarget({
      fixture,
      targetKey,
    });
    const { connectionId, endpointKey } = await createGitHubWebhookConnection({
      fixture,
      targetKey,
      email: "integration-webhooks-ingest-duplicate@example.com",
      displayName: "Duplicate webhook connection",
      installationId: InstallationId,
      webhookSecret,
    });

    const payload = JSON.stringify(createGitHubWebhookPayload());
    const headers = {
      "content-type": "application/json",
      "x-github-event": GitHubEventTypeHeader,
      "x-github-delivery": externalDeliveryId,
      "x-hub-signature-256": signGitHubWebhookPayload({
        secret: webhookSecret,
        payload,
      }),
    };

    const firstResponse = await fixture.request(
      `/p/integration/webhooks/${targetKey}/${endpointKey}`,
      {
        method: "POST",
        headers,
        body: payload,
      },
    );
    expect(firstResponse.status).toBe(202);
    const firstResponseBody = IngestIntegrationWebhookResponseSchema.parse(
      await firstResponse.json(),
    );
    expect(firstResponseBody.status).toBe("received");

    const secondResponse = await fixture.request(
      `/p/integration/webhooks/${targetKey}/${endpointKey}`,
      {
        method: "POST",
        headers,
        body: payload,
      },
    );
    expect(secondResponse.status).toBe(202);
    const secondResponseBody = IngestIntegrationWebhookResponseSchema.parse(
      await secondResponse.json(),
    );
    expect(secondResponseBody.status).toBe("duplicate");

    const persistedEvents = await fixture.db.query.integrationWebhookEvents.findMany({
      where: (table, { and, eq }) =>
        and(eq(table.targetKey, targetKey), eq(table.externalEventId, externalDeliveryId)),
    });
    expect(persistedEvents).toHaveLength(1);
    const [persistedEvent] = persistedEvents;
    if (persistedEvent === undefined) {
      throw new Error("Expected persisted webhook event.");
    }

    const persistedSources = await fixture.db.query.integrationWebhookSources.findMany({
      where: (table, { and, eq }) =>
        and(eq(table.targetKey, targetKey), eq(table.integrationConnectionId, connectionId)),
    });
    expect(persistedSources).toHaveLength(1);
    const [persistedSource] = persistedSources;
    if (persistedSource === undefined) {
      throw new Error("Expected persisted webhook source.");
    }
    expect(persistedEvent.integrationWebhookSourceId).toBe(persistedSource.id);

    const workflowRuns = await listWebhookWorkflowRuns({
      databaseUrl: fixture.databaseStack.directUrl,
      webhookEventId: persistedEvent.id,
    });
    expect(workflowRuns).toHaveLength(1);
    const [workflowRun] = workflowRuns;
    if (workflowRun === undefined) {
      throw new Error("Expected exactly one webhook workflow run.");
    }
    expect(workflowRun.idempotencyKey).toBe(persistedEvent.id);
  });

  it("accepts a valid Slack path-routed webhook and stores the normalized event", async ({
    fixture,
  }) => {
    const targetKey = "slack-default";
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const authenticatedSession = await fixture.authSession({
      email: "integration-webhooks-ingest-slack-message@example.com",
    });

    await fixture.db
      .insert(integrationTargets)
      .values({
        targetKey,
        familyId: "slack",
        variantId: "slack-default",
        enabled: true,
        config: {
          api_base_url: "https://slack.com/api",
        },
      })
      .onConflictDoUpdate({
        target: integrationTargets.targetKey,
        set: {
          familyId: "slack",
          variantId: "slack-default",
          enabled: true,
          config: {
            api_base_url: "https://slack.com/api",
          },
        },
      });

    const createConnectionResponse = await fixture.request(
      "/v1/integration/connections/slack-default/form",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: authenticatedSession.cookie,
        },
        body: JSON.stringify({
          displayName: "Slack Events API",
          methodId: "slack-bot-token",
          config: {
            connection_method: "slack-bot-token",
          },
          secrets: {
            botToken: "xoxb-test-bot-token",
            signingSecret: "slack-signing-secret",
          },
        }),
      },
    );

    expect(createConnectionResponse.status).toBe(201);
    const createdConnection = IntegrationConnectionSchema.parse(
      await createConnectionResponse.json(),
    );

    const createdSource = await fixture.db.query.integrationWebhookSources.findFirst({
      where: (table, { and, eq }) =>
        and(
          eq(table.organizationId, authenticatedSession.organizationId),
          eq(table.integrationConnectionId, createdConnection.id),
          eq(table.targetKey, targetKey),
        ),
    });
    expect(createdSource).toBeDefined();

    if (createdSource?.endpointKey === undefined) {
      throw new Error("Expected Slack implicit path-routed webhook source.");
    }

    const payloadObject = createSlackMessageWebhookPayload();
    const payload = JSON.stringify(payloadObject);
    const response = await fixture.request(
      `/p/integration/webhooks/${targetKey}/${createdSource.endpointKey}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-slack-request-timestamp": timestamp,
          "x-slack-signature": signSlackWebhookPayload({
            secret: "slack-signing-secret",
            payload,
            timestamp,
          }),
        },
        body: payload,
      },
    );

    expect(response.status).toBe(202);
    const responseBody = IngestIntegrationWebhookResponseSchema.parse(await response.json());
    expect(responseBody).toEqual({
      status: "received",
    });

    const persistedEvent = await fixture.db.query.integrationWebhookEvents.findFirst({
      where: (table, { and, eq }) =>
        and(eq(table.targetKey, targetKey), eq(table.externalEventId, "Ev123")),
    });

    expect(persistedEvent).toBeDefined();
    if (persistedEvent === undefined) {
      throw new Error("Expected Slack webhook event to be stored.");
    }

    expect(persistedEvent.integrationConnectionId).toBe(createdConnection.id);
    expect(persistedEvent.integrationWebhookSourceId).toBe(createdSource.id);
    expect(persistedEvent.providerEventType).toBe("message");
    expect(persistedEvent.eventType).toBe("slack:message");
    expect(persistedEvent.payload).toEqual({
      ...payloadObject,
      event: {
        ...createSlackMessageEventPayload(),
        [SlackThreadRootTimestampField]: "1710000000.000100",
      },
    });
    expect(new Date(String(persistedEvent.sourceOccurredAt)).toISOString()).toBe(
      "2024-03-09T16:00:00.000Z",
    );
    expect(persistedEvent.sourceOrderKey).toBe("2024-03-09T16:00:00.000Z#1710000000.000100");
  });

  it("enriches Slack reaction webhooks with thread metadata before storing them", async ({
    fixture,
  }) => {
    const targetKey = "slack-default";
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const authenticatedSession = await fixture.authSession({
      email: "integration-webhooks-ingest-slack-reaction@example.com",
    });
    const requests: Array<{
      authorization: string | undefined;
      pathname: string;
      search: string;
    }> = [];
    const host = "127.0.0.1";
    const port = await reserveAvailablePort({ host });
    const server = createServer((request, response) => {
      const requestUrl = new URL(request.url ?? "/", `http://${host}:${String(port)}`);
      requests.push({
        authorization:
          typeof request.headers.authorization === "string"
            ? request.headers.authorization
            : undefined,
        pathname: requestUrl.pathname,
        search: requestUrl.search,
      });
      response.statusCode = 200;
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          ok: true,
          messages: [
            {
              type: "message",
              user: "U234",
              text: "Thread reply",
              ts: "1710000000.000200",
              thread_ts: "1710000000.000100",
            },
          ],
        }),
      );
    });
    server.listen(port, host);
    await once(server, "listening");

    try {
      await fixture.db
        .insert(integrationTargets)
        .values({
          targetKey,
          familyId: "slack",
          variantId: "slack-default",
          enabled: true,
          config: {
            api_base_url: `http://${host}:${String(port)}/api`,
          },
        })
        .onConflictDoUpdate({
          target: integrationTargets.targetKey,
          set: {
            familyId: "slack",
            variantId: "slack-default",
            enabled: true,
            config: {
              api_base_url: `http://${host}:${String(port)}/api`,
            },
          },
        });

      const createConnectionResponse = await fixture.request(
        "/v1/integration/connections/slack-default/form",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: authenticatedSession.cookie,
          },
          body: JSON.stringify({
            displayName: "Slack reactions",
            methodId: "slack-bot-token",
            config: {
              connection_method: "slack-bot-token",
            },
            secrets: {
              botToken: "xoxb-test-bot-token",
              signingSecret: "slack-signing-secret",
            },
          }),
        },
      );

      expect(createConnectionResponse.status).toBe(201);
      const createdConnection = IntegrationConnectionSchema.parse(
        await createConnectionResponse.json(),
      );

      const createdSource = await fixture.db.query.integrationWebhookSources.findFirst({
        where: (table, { and, eq }) =>
          and(
            eq(table.organizationId, authenticatedSession.organizationId),
            eq(table.integrationConnectionId, createdConnection.id),
            eq(table.targetKey, targetKey),
          ),
      });
      expect(createdSource).toBeDefined();

      if (createdSource?.endpointKey === undefined) {
        throw new Error("Expected Slack implicit path-routed webhook source.");
      }

      const payloadObject = createSlackReactionWebhookPayload();
      const payload = JSON.stringify(payloadObject);
      const response = await fixture.request(
        `/p/integration/webhooks/${targetKey}/${createdSource.endpointKey}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-slack-request-timestamp": timestamp,
            "x-slack-signature": signSlackWebhookPayload({
              secret: "slack-signing-secret",
              payload,
              timestamp,
            }),
          },
          body: payload,
        },
      );

      expect(response.status).toBe(202);
      expect(IngestIntegrationWebhookResponseSchema.parse(await response.json())).toEqual({
        status: "received",
      });
      expect(requests).toEqual([
        {
          authorization: "Bearer xoxb-test-bot-token",
          pathname: "/api/conversations.replies",
          search: "?channel=C123&ts=1710000000.000200",
        },
      ]);

      const persistedEvent = await fixture.db.query.integrationWebhookEvents.findFirst({
        where: (table, { and, eq }) =>
          and(eq(table.targetKey, targetKey), eq(table.externalEventId, "Ev125")),
      });

      expect(persistedEvent).toBeDefined();
      if (persistedEvent === undefined) {
        throw new Error("Expected Slack reaction webhook event to be stored.");
      }

      expect(persistedEvent.integrationConnectionId).toBe(createdConnection.id);
      expect(persistedEvent.integrationWebhookSourceId).toBe(createdSource.id);
      expect(persistedEvent.providerEventType).toBe("reaction_added");
      expect(persistedEvent.eventType).toBe("slack:reaction_added");
      expect(persistedEvent.payload).toEqual({
        ...payloadObject,
        event: {
          ...createSlackReactionEventPayload(),
          channel: "C123",
          [SlackThreadRootTimestampField]: "1710000000.000100",
        },
      });
    } finally {
      server.close();
      await once(server, "close");
    }
  });

  it("stores Slack message subtypes outside the slack:message automation path", async ({
    fixture,
  }) => {
    const targetKey = "slack-default";
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const authenticatedSession = await fixture.authSession({
      email: "integration-webhooks-ingest-slack-message-subtype@example.com",
    });

    await fixture.db
      .insert(integrationTargets)
      .values({
        targetKey,
        familyId: "slack",
        variantId: "slack-default",
        enabled: true,
        config: {
          api_base_url: "https://slack.com/api",
        },
      })
      .onConflictDoUpdate({
        target: integrationTargets.targetKey,
        set: {
          familyId: "slack",
          variantId: "slack-default",
          enabled: true,
          config: {
            api_base_url: "https://slack.com/api",
          },
        },
      });

    const createConnectionResponse = await fixture.request(
      "/v1/integration/connections/slack-default/form",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: authenticatedSession.cookie,
        },
        body: JSON.stringify({
          displayName: "Slack message subtype",
          methodId: "slack-bot-token",
          config: {
            connection_method: "slack-bot-token",
          },
          secrets: {
            botToken: "xoxb-test-bot-token",
            signingSecret: "slack-signing-secret",
          },
        }),
      },
    );

    expect(createConnectionResponse.status).toBe(201);
    const createdConnection = IntegrationConnectionSchema.parse(
      await createConnectionResponse.json(),
    );

    const createdSource = await fixture.db.query.integrationWebhookSources.findFirst({
      where: (table, { and, eq }) =>
        and(
          eq(table.organizationId, authenticatedSession.organizationId),
          eq(table.integrationConnectionId, createdConnection.id),
          eq(table.targetKey, targetKey),
        ),
    });

    expect(createdSource).toBeDefined();
    if (createdSource?.endpointKey === undefined) {
      throw new Error("Expected Slack implicit path-routed webhook source.");
    }

    const payloadObject = createSlackMessageDeletedWebhookPayload();
    const payload = JSON.stringify(payloadObject);
    const response = await fixture.request(
      `/p/integration/webhooks/${targetKey}/${createdSource.endpointKey}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-slack-request-timestamp": timestamp,
          "x-slack-signature": signSlackWebhookPayload({
            secret: "slack-signing-secret",
            payload,
            timestamp,
          }),
        },
        body: payload,
      },
    );

    expect(response.status).toBe(202);
    const persistedEvent = await fixture.db.query.integrationWebhookEvents.findFirst({
      where: (table, { and, eq }) =>
        and(eq(table.targetKey, targetKey), eq(table.externalEventId, "Ev124")),
    });

    expect(persistedEvent).toBeDefined();
    if (persistedEvent === undefined) {
      throw new Error("Expected Slack webhook event to be stored.");
    }

    expect(persistedEvent.integrationConnectionId).toBe(createdConnection.id);
    expect(persistedEvent.integrationWebhookSourceId).toBe(createdSource.id);
    expect(persistedEvent.providerEventType).toBe("message_deleted");
    expect(persistedEvent.eventType).toBe("slack:message_deleted");
    expect(persistedEvent.payload).toEqual(payloadObject);
  });

  it("responds to Slack URL verification after signature verification without storing an event", async ({
    fixture,
  }) => {
    const targetKey = "slack-default";
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const authenticatedSession = await fixture.authSession({
      email: "integration-webhooks-ingest-slack-url-verification@example.com",
    });

    await fixture.db
      .insert(integrationTargets)
      .values({
        targetKey,
        familyId: "slack",
        variantId: "slack-default",
        enabled: true,
        config: {
          api_base_url: "https://slack.com/api",
        },
      })
      .onConflictDoUpdate({
        target: integrationTargets.targetKey,
        set: {
          familyId: "slack",
          variantId: "slack-default",
          enabled: true,
          config: {
            api_base_url: "https://slack.com/api",
          },
        },
      });

    const createConnectionResponse = await fixture.request(
      "/v1/integration/connections/slack-default/form",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: authenticatedSession.cookie,
        },
        body: JSON.stringify({
          displayName: "Slack URL verification",
          methodId: "slack-bot-token",
          config: {
            connection_method: "slack-bot-token",
          },
          secrets: {
            botToken: "xoxb-test-bot-token",
            signingSecret: "slack-signing-secret",
          },
        }),
      },
    );

    expect(createConnectionResponse.status).toBe(201);
    const createdConnection = IntegrationConnectionSchema.parse(
      await createConnectionResponse.json(),
    );

    const createdSource = await fixture.db.query.integrationWebhookSources.findFirst({
      where: (table, { and, eq }) =>
        and(
          eq(table.organizationId, authenticatedSession.organizationId),
          eq(table.integrationConnectionId, createdConnection.id),
          eq(table.targetKey, targetKey),
        ),
    });
    expect(createdSource).toBeDefined();

    if (createdSource?.endpointKey === undefined) {
      throw new Error("Expected Slack implicit path-routed webhook source.");
    }

    const payloadObject = createSlackUrlVerificationPayload();
    const payload = JSON.stringify(payloadObject);
    const response = await fixture.request(
      `/p/integration/webhooks/${targetKey}/${createdSource.endpointKey}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-slack-request-timestamp": timestamp,
          "x-slack-signature": signSlackWebhookPayload({
            secret: "slack-signing-secret",
            payload,
            timestamp,
          }),
        },
        body: payload,
      },
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("challenge-value");

    const persistedEvents = await fixture.db.query.integrationWebhookEvents.findMany({
      where: (table, { and, eq }) =>
        and(
          eq(table.targetKey, targetKey),
          eq(table.integrationConnectionId, createdConnection.id),
        ),
    });
    expect(persistedEvents).toEqual([]);
  });

  it("accepts a valid Jira path-routed webhook and stores the event against the source", async ({
    fixture,
  }) => {
    const targetKey = "jira-default";
    const connectionId = "icn_jira_webhook_ingest_success";
    const endpointKey = "ep_jira_ingest_success";
    const webhookSecret = "whsec_jira_ingest";
    const externalEventId = "jira-webhook-evt-1";
    const siteUrl = "https://mistle-test.atlassian.net";
    const authenticatedSession = await fixture.authSession({
      email: "integration-webhooks-ingest-jira@example.com",
    });

    await fixture.db
      .insert(integrationTargets)
      .values({
        targetKey,
        familyId: "jira",
        variantId: "jira-default",
        enabled: true,
        config: {},
      })
      .onConflictDoUpdate({
        target: integrationTargets.targetKey,
        set: {
          familyId: "jira",
          variantId: "jira-default",
          enabled: true,
          config: {},
        },
      });

    await fixture.db.insert(integrationConnections).values({
      id: connectionId,
      organizationId: authenticatedSession.organizationId,
      targetKey,
      displayName: "Jira webhook connection",
      status: IntegrationConnectionStatuses.ACTIVE,
      config: {
        connection_method: "jira-personal-api-token",
        site_url: siteUrl,
        email: "jira@example.com",
      },
    });
    await createConnectionApiKeyCredential({
      fixture,
      organizationId: authenticatedSession.organizationId,
      familyId: "jira",
      connectionId,
      slotKey: "jira.jira-default.jira-personal-api-token.api-key",
      secret: "jira-personal-token",
    });

    const webhookSecretCredentialId = await createWebhookSecretCredential({
      fixture,
      organizationId: authenticatedSession.organizationId,
      familyId: "jira",
      secret: webhookSecret,
    });

    const [createdSource] = await fixture.db
      .insert(integrationWebhookSources)
      .values({
        organizationId: authenticatedSession.organizationId,
        integrationConnectionId: connectionId,
        targetKey,
        displayName: "Jira admin webhook",
        endpointKey,
        webhookSecretCredentialId,
        status: IntegrationWebhookSourceStatuses.ACTIVE,
      })
      .returning();

    if (createdSource === undefined) {
      throw new Error("Expected Jira webhook source.");
    }

    const payloadObject = createJiraWebhookPayload({
      siteUrl,
    });
    const payload = JSON.stringify(payloadObject);
    const response = await fixture.request(`/p/integration/webhooks/${targetKey}/${endpointKey}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-atlassian-webhook-identifier": externalEventId,
        "x-hub-signature": signJiraWebhookPayload({
          secret: webhookSecret,
          payload,
        }),
      },
      body: payload,
    });

    const responseBodyPayload = await response.json();
    if (response.status !== 202) {
      throw new Error(
        `Unexpected status ${response.status}: ${JSON.stringify(responseBodyPayload)}`,
      );
    }
    const responseBody = IngestIntegrationWebhookResponseSchema.parse(responseBodyPayload);
    expect(responseBody).toEqual({
      status: "received",
    });

    const persistedEvent = await fixture.db.query.integrationWebhookEvents.findFirst({
      where: (table, { eq }) => eq(table.externalEventId, externalEventId),
    });

    expect(persistedEvent).toBeDefined();
    if (persistedEvent === undefined) {
      throw new Error("Expected Jira webhook event to be stored.");
    }

    expect(persistedEvent.integrationConnectionId).toBe(connectionId);
    expect(persistedEvent.integrationWebhookSourceId).toBe(createdSource.id);
    expect(persistedEvent.eventType).toBe("jira:issue_created");
    expect(persistedEvent.providerEventType).toBe("jira:issue_created");
    expect(persistedEvent.payload).toEqual(payloadObject);
    expect(new Date(String(persistedEvent.sourceOccurredAt)).toISOString()).toBe(
      "2026-04-02T17:42:43.000Z",
    );
  });
});
