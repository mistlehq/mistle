import { createHmac } from "node:crypto";

import {
  integrationConnections,
  IntegrationConnectionStatuses,
  integrationTargets,
} from "@mistle/db/control-plane";
import { ControlPlaneOpenWorkflow } from "@mistle/workflows/control-plane";
import { Pool } from "pg";
import { describe, expect } from "vitest";

import {
  encryptIntegrationTargetSecrets,
  resolveMasterEncryptionKeyMaterial,
} from "../src/integration-credentials/crypto.js";
import {
  IngestIntegrationWebhookResponseSchema,
  IntegrationWebhooksBadRequestResponseSchema,
  IntegrationWebhooksNotFoundResponseSchema,
} from "../src/integration-webhooks/contracts.js";
import { it } from "./test-context.js";

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
      created_at: "2026-03-08T08:15:30Z",
      body: "Hello webhook",
    },
  };
}

function signGitHubWebhookPayload(input: { secret: string; payload: string }): string {
  const digest = createHmac("sha256", input.secret).update(input.payload, "utf8").digest("hex");
  return `sha256=${digest}`;
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
        from ${ControlPlaneOpenWorkflow.SCHEMA}.workflow_runs wr
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
    expect(persistedEvent.sourceOccurredAt).toBe("2026-03-08 08:15:30+00");
    expect(persistedEvent.sourceOrderKey).toBe("2026-03-08T08:15:30Z#00000000000000001001");
    expect(persistedEvent.payload).toEqual(payloadObject);

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
});
