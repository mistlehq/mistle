import { createHmac } from "node:crypto";

import {
  integrationConnections,
  integrationCredentials,
  IntegrationConnectionStatuses,
  IntegrationCredentialSecretKinds,
  integrationTargets,
  integrationWebhookSources,
  IntegrationWebhookSourceOwnerScopes,
  IntegrationWebhookSourceRoutingStrategies,
  IntegrationWebhookSourceStatuses,
} from "@mistle/db/control-plane";
import { Pool } from "pg";
import { describe, expect } from "vitest";

import {
  IngestIntegrationWebhookResponseSchema,
  IntegrationWebhooksBadRequestResponseSchema,
  IntegrationWebhooksNotFoundResponseSchema,
} from "../src/integration-webhooks/index.js";
import {
  encryptCredentialUtf8,
  encryptIntegrationTargetSecrets,
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
    const connectionId = "icn_webhook_ingest_success";
    const webhookSecret = "whsec_test_valid";
    const externalDeliveryId = "delivery_success_1";
    const authenticatedSession = await fixture.authSession({
      email: "integration-webhooks-ingest-success@example.com",
    });

    const masterEncryptionKeyMaterial = resolveMasterEncryptionKeyMaterial({
      masterKeyVersion: fixture.config.integrations.activeMasterEncryptionKeyVersion,
      masterEncryptionKeys: fixture.config.integrations.masterEncryptionKeys,
    });
    const encryptedTargetSecrets = encryptIntegrationTargetSecrets({
      secrets: {
        webhook_secret: webhookSecret,
      },
      masterKeyVersion: fixture.config.integrations.activeMasterEncryptionKeyVersion,
      masterEncryptionKeyMaterial,
    });
    await fixture.db.insert(integrationTargets).values({
      targetKey,
      familyId: "github",
      variantId: "github-cloud",
      enabled: true,
      config: {
        api_base_url: "https://api.github.com",
        web_base_url: "https://github.com",
      },
      secrets: encryptedTargetSecrets,
    });

    await fixture.db.insert(integrationConnections).values({
      id: connectionId,
      organizationId: authenticatedSession.organizationId,
      targetKey,
      displayName: "Webhook ingest connection",
      status: IntegrationConnectionStatuses.ACTIVE,
      externalSubjectId: InstallationId,
      config: {},
    });

    const payloadObject = createGitHubWebhookPayload();
    const payload = JSON.stringify(payloadObject);
    const response = await fixture.request(`/v1/integration/webhooks/${targetKey}`, {
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
    expect(persistedEvent.organizationId).toBe(authenticatedSession.organizationId);
    expect(persistedEvent.integrationConnectionId).toBe(connectionId);
    expect(persistedEvent.integrationWebhookSourceId).toBeDefined();
    expect(persistedEvent.payload).toEqual(payloadObject);
    expect(new Date(String(persistedEvent.sourceOccurredAt)).toISOString()).toBe(
      "2026-03-10T00:00:00.000Z",
    );
    expect(persistedEvent.sourceOrderKey).toBe("2026-03-10T00:00:00Z#00000000000000001001");

    const persistedSource = await fixture.db.query.integrationWebhookSources.findFirst({
      where: (table, { and, eq }) =>
        and(
          eq(table.targetKey, targetKey),
          eq(table.ownerScope, IntegrationWebhookSourceOwnerScopes.TARGET),
        ),
    });

    expect(persistedSource).toBeDefined();
    if (persistedSource === undefined) {
      throw new Error("Expected implicit target webhook source to be created.");
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
    const authenticatedSession = await fixture.authSession({
      email: "integration-webhooks-ingest-invalid-signature@example.com",
    });

    const masterEncryptionKeyMaterial = resolveMasterEncryptionKeyMaterial({
      masterKeyVersion: fixture.config.integrations.activeMasterEncryptionKeyVersion,
      masterEncryptionKeys: fixture.config.integrations.masterEncryptionKeys,
    });
    const encryptedTargetSecrets = encryptIntegrationTargetSecrets({
      secrets: {
        webhook_secret: webhookSecret,
      },
      masterKeyVersion: fixture.config.integrations.activeMasterEncryptionKeyVersion,
      masterEncryptionKeyMaterial,
    });
    await fixture.db.insert(integrationTargets).values({
      targetKey,
      familyId: "github",
      variantId: "github-cloud",
      enabled: true,
      config: {
        api_base_url: "https://api.github.com",
        web_base_url: "https://github.com",
      },
      secrets: encryptedTargetSecrets,
    });

    await fixture.db.insert(integrationConnections).values({
      id: "icn_webhook_ingest_invalid_signature",
      organizationId: authenticatedSession.organizationId,
      targetKey,
      displayName: "Invalid signature connection",
      status: IntegrationConnectionStatuses.ACTIVE,
      externalSubjectId: InstallationId,
      config: {},
    });

    const payloadObject = createGitHubWebhookPayload();
    const payload = JSON.stringify(payloadObject);
    const response = await fixture.request(`/v1/integration/webhooks/${targetKey}`, {
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

  it("returns 404 when no active integration connection matches the webhook subject", async ({
    fixture,
  }) => {
    const targetKey = "github-cloud-webhook-ingest-missing-connection";
    const externalDeliveryId = "delivery_missing_connection_1";

    await fixture.db.insert(integrationTargets).values({
      targetKey,
      familyId: "github",
      variantId: "github-cloud",
      enabled: true,
      config: {
        api_base_url: "https://api.github.com",
        web_base_url: "https://github.com",
      },
      secrets: encryptIntegrationTargetSecrets({
        secrets: {
          webhook_secret: "whsec_missing_connection",
        },
        masterKeyVersion: fixture.config.integrations.activeMasterEncryptionKeyVersion,
        masterEncryptionKeyMaterial: resolveMasterEncryptionKeyMaterial({
          masterKeyVersion: fixture.config.integrations.activeMasterEncryptionKeyVersion,
          masterEncryptionKeys: fixture.config.integrations.masterEncryptionKeys,
        }),
      }),
    });

    const payload = JSON.stringify(createGitHubWebhookPayload());
    const response = await fixture.request(`/v1/integration/webhooks/${targetKey}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": GitHubEventTypeHeader,
        "x-github-delivery": externalDeliveryId,
        "x-hub-signature-256": signGitHubWebhookPayload({
          secret: "whsec_missing_connection",
          payload,
        }),
      },
      body: payload,
    });

    expect(response.status).toBe(404);
    const responseBody = IntegrationWebhooksNotFoundResponseSchema.parse(await response.json());
    expect(responseBody.code).toBe("CONNECTION_NOT_FOUND");
  });

  it("returns duplicate for repeated external event ids and keeps one stored row", async ({
    fixture,
  }) => {
    const targetKey = "github-cloud-webhook-ingest-duplicate";
    const webhookSecret = "whsec_duplicate_secret";
    const externalDeliveryId = "delivery_duplicate_1";
    const authenticatedSession = await fixture.authSession({
      email: "integration-webhooks-ingest-duplicate@example.com",
    });

    const masterEncryptionKeyMaterial = resolveMasterEncryptionKeyMaterial({
      masterKeyVersion: fixture.config.integrations.activeMasterEncryptionKeyVersion,
      masterEncryptionKeys: fixture.config.integrations.masterEncryptionKeys,
    });
    const encryptedTargetSecrets = encryptIntegrationTargetSecrets({
      secrets: {
        webhook_secret: webhookSecret,
      },
      masterKeyVersion: fixture.config.integrations.activeMasterEncryptionKeyVersion,
      masterEncryptionKeyMaterial,
    });
    await fixture.db.insert(integrationTargets).values({
      targetKey,
      familyId: "github",
      variantId: "github-cloud",
      enabled: true,
      config: {
        api_base_url: "https://api.github.com",
        web_base_url: "https://github.com",
      },
      secrets: encryptedTargetSecrets,
    });

    await fixture.db.insert(integrationConnections).values({
      id: "icn_webhook_ingest_duplicate",
      organizationId: authenticatedSession.organizationId,
      targetKey,
      displayName: "Duplicate webhook connection",
      status: IntegrationConnectionStatuses.ACTIVE,
      externalSubjectId: InstallationId,
      config: {},
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

    const firstResponse = await fixture.request(`/v1/integration/webhooks/${targetKey}`, {
      method: "POST",
      headers,
      body: payload,
    });
    expect(firstResponse.status).toBe(202);
    const firstResponseBody = IngestIntegrationWebhookResponseSchema.parse(
      await firstResponse.json(),
    );
    expect(firstResponseBody.status).toBe("received");

    const secondResponse = await fixture.request(`/v1/integration/webhooks/${targetKey}`, {
      method: "POST",
      headers,
      body: payload,
    });
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
        and(
          eq(table.targetKey, targetKey),
          eq(table.ownerScope, IntegrationWebhookSourceOwnerScopes.TARGET),
        ),
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

    const webhookSecretCredentialId = await createWebhookSecretCredential({
      fixture,
      organizationId: authenticatedSession.organizationId,
      familyId: "jira",
      secret: webhookSecret,
    });

    const [createdSource] = await fixture.db
      .insert(integrationWebhookSources)
      .values({
        ownerScope: "connection",
        organizationId: authenticatedSession.organizationId,
        integrationConnectionId: connectionId,
        targetKey,
        displayName: "Jira admin webhook",
        routingStrategy: IntegrationWebhookSourceRoutingStrategies.PATH,
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
    const response = await fixture.request(`/v1/integration/webhooks/${targetKey}/${endpointKey}`, {
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

    expect(response.status).toBe(202);
    const responseBody = IngestIntegrationWebhookResponseSchema.parse(await response.json());
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
    expect(persistedEvent.sourceOccurredAt).toBe("2026-04-02T17:42:43.000Z");
  });
});
