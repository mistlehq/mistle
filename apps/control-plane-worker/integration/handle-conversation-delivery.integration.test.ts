import { ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import {
  automationRuns,
  AutomationRunStatuses,
  automationTargets,
  automations,
  AutomationKinds,
  conversationDeliveryProcessors,
  ConversationDeliveryProcessorStatuses,
  conversationDeliveryTasks,
  ConversationDeliveryTaskStatuses,
  conversationRoutes,
  ConversationRouteStatuses,
  conversations,
  ConversationCreatedByKinds,
  ConversationOwnerKinds,
  ConversationProviderFamilies,
  ConversationStatuses,
  createControlPlaneDatabase,
  IntegrationBindingKinds,
  integrationConnections,
  IntegrationConnectionStatuses,
  integrationTargets,
  integrationWebhookEvents,
  IntegrationWebhookEventStatuses,
  organizations,
  sandboxProfiles,
  sandboxProfileVersionIntegrationBindings,
  sandboxProfileVersions,
  CONTROL_PLANE_SCHEMA_NAME,
} from "@mistle/db/control-plane";
import {
  CONTROL_PLANE_MIGRATIONS_FOLDER_PATH,
  MigrationTracking,
  runControlPlaneMigrations,
} from "@mistle/db/migrator";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { describe, expect } from "vitest";

import { handleConversationDelivery } from "../src/runtime/services/handle-conversation-delivery.js";
import { it } from "./test-context.js";

const TestTimeoutMs = 120_000;

async function createTestDatabase(input: { databaseUrl: string }) {
  await runControlPlaneMigrations({
    connectionString: input.databaseUrl,
    schemaName: CONTROL_PLANE_SCHEMA_NAME,
    migrationsFolder: CONTROL_PLANE_MIGRATIONS_FOLDER_PATH,
    migrationsSchema: MigrationTracking.CONTROL_PLANE.SCHEMA_NAME,
    migrationsTable: MigrationTracking.CONTROL_PLANE.TABLE_NAME,
  });

  const pool = new Pool({
    connectionString: input.databaseUrl,
  });
  const db = createControlPlaneDatabase(pool);

  return {
    db,
    stop: async () => {
      await pool.end();
    },
  };
}

function createInternalClient(input: { baseUrl: string; internalAuthServiceToken: string }) {
  return new ControlPlaneInternalClient({
    baseUrl: input.baseUrl,
    internalAuthServiceToken: input.internalAuthServiceToken,
  });
}

async function seedConversationDeliveryBase(input: {
  database: Awaited<ReturnType<typeof createTestDatabase>>;
  suffix: string;
  withAgentBinding?: boolean;
}) {
  const organizationId = `org_${input.suffix}`;
  const sandboxProfileId = `sbp_${input.suffix}`;
  const automationId = `atm_${input.suffix}`;
  const automationTargetId = `atg_${input.suffix}`;
  const conversationId = `cnv_${input.suffix}`;
  const targetKey = `github-cloud-${input.suffix}`;
  const connectionId = `icn_${input.suffix}`;
  const webhookEventId = `iwe_${input.suffix}`;
  const automationRunId = `aru_${input.suffix}`;
  const processorWorkflowRunId = `wfr_${input.suffix}`;

  await input.database.db.insert(organizations).values({
    id: organizationId,
    name: `Organization ${input.suffix}`,
    slug: input.suffix,
  });
  await input.database.db.insert(sandboxProfiles).values({
    id: sandboxProfileId,
    organizationId,
    displayName: `Profile ${input.suffix}`,
    status: "active",
  });
  await input.database.db.insert(integrationTargets).values({
    targetKey,
    familyId: "github",
    variantId: "github-cloud",
    enabled: true,
    config: {
      api_base_url: "https://api.github.com",
      web_base_url: "https://github.com",
    },
  });
  await input.database.db.insert(integrationConnections).values({
    id: connectionId,
    organizationId,
    targetKey,
    displayName: `Connection ${input.suffix}`,
    status: IntegrationConnectionStatuses.ACTIVE,
    externalSubjectId: `subject_${input.suffix}`,
    config: {},
  });
  await input.database.db.insert(automations).values({
    id: automationId,
    organizationId,
    kind: AutomationKinds.WEBHOOK,
    name: `Automation ${input.suffix}`,
    enabled: true,
  });
  await input.database.db.insert(automationTargets).values({
    id: automationTargetId,
    automationId,
    sandboxProfileId,
    sandboxProfileVersion: 1,
  });
  await input.database.db.insert(conversations).values({
    id: conversationId,
    organizationId,
    ownerKind: ConversationOwnerKinds.AUTOMATION_TARGET,
    ownerId: automationTargetId,
    conversationKey: `conversation-${input.suffix}`,
    sandboxProfileId,
    providerFamily: ConversationProviderFamilies.CODEX,
    status: ConversationStatuses.ACTIVE,
    createdByKind: ConversationCreatedByKinds.WEBHOOK,
    createdById: `seed_${input.suffix}`,
    title: null,
    preview: `Preview ${input.suffix}`,
  });
  await input.database.db.insert(conversationDeliveryProcessors).values({
    conversationId,
    generation: 1,
    status: ConversationDeliveryProcessorStatuses.RUNNING,
    activeWorkflowRunId: processorWorkflowRunId,
  });
  await input.database.db.insert(integrationWebhookEvents).values({
    id: webhookEventId,
    organizationId,
    integrationConnectionId: connectionId,
    targetKey,
    externalEventId: `evt_${input.suffix}`,
    externalDeliveryId: `delivery_${input.suffix}`,
    providerEventType: "issue_comment",
    eventType: "github.issue_comment.created",
    payload: {
      issue: {
        number: 1,
      },
      comment: {
        body: "comment",
      },
    },
    status: IntegrationWebhookEventStatuses.PROCESSED,
    sourceOccurredAt: "2026-03-08T08:59:00Z",
    sourceOrderKey: `2026-03-08T08:59:00Z#${input.suffix}`,
  });
  await input.database.db.insert(automationRuns).values({
    id: automationRunId,
    automationId,
    automationTargetId,
    sourceWebhookEventId: webhookEventId,
    conversationId,
    renderedInput: `Handle ${input.suffix}`,
    renderedConversationKey: "issue-1",
    status: AutomationRunStatuses.RUNNING,
  });

  if (input.withAgentBinding === true) {
    const agentTargetKey = `openai-default-${input.suffix}`;
    const agentConnectionId = `icn_agent_${input.suffix}`;

    await input.database.db.insert(integrationTargets).values({
      targetKey: agentTargetKey,
      familyId: "openai",
      variantId: "openai-default",
      enabled: true,
      config: {},
    });
    await input.database.db.insert(integrationConnections).values({
      id: agentConnectionId,
      organizationId,
      targetKey: agentTargetKey,
      displayName: `Agent Connection ${input.suffix}`,
      status: IntegrationConnectionStatuses.ACTIVE,
      externalSubjectId: `openai-agent-${input.suffix}`,
      config: {
        auth_scheme: "api_key",
      },
    });
    await input.database.db.insert(sandboxProfileVersions).values({
      sandboxProfileId,
      version: 1,
    });
    await input.database.db.insert(sandboxProfileVersionIntegrationBindings).values({
      sandboxProfileId,
      sandboxProfileVersion: 1,
      connectionId: agentConnectionId,
      kind: IntegrationBindingKinds.AGENT,
      config: {
        runtime: "codex-cli",
        defaultModel: "gpt-5.3-codex",
        reasoningEffort: "medium",
      },
    });
  }

  return {
    organizationId,
    sandboxProfileId,
    automationId,
    automationTargetId,
    conversationId,
    connectionId,
    targetKey,
    webhookEventId,
    automationRunId,
    processorWorkflowRunId,
  };
}

describe("handleConversationDelivery integration", () => {
  it(
    "marks stale queued tasks ignored and releases the coordinator",
    async ({ fixture }) => {
      const database = await createTestDatabase({
        databaseUrl: fixture.config.workflow.databaseUrl,
      });

      try {
        const seeded = await seedConversationDeliveryBase({
          database,
          suffix: "worker_conversation_delivery_stale",
        });
        await database.db
          .update(conversations)
          .set({
            lastProcessedSourceOrderKey: "2026-03-08T09:00:00Z#00000000000000002000",
          })
          .where(eq(conversations.id, seeded.conversationId));
        await database.db
          .update(integrationWebhookEvents)
          .set({
            sourceOrderKey: "2026-03-08T08:59:00Z#00000000000000001999",
          })
          .where(eq(integrationWebhookEvents.id, seeded.webhookEventId));
        await database.db.insert(conversationDeliveryTasks).values({
          id: "cdt_worker_conversation_delivery_stale",
          conversationId: seeded.conversationId,
          automationRunId: seeded.automationRunId,
          sourceWebhookEventId: seeded.webhookEventId,
          sourceOrderKey: "2026-03-08T08:59:00Z#00000000000000001999",
          status: ConversationDeliveryTaskStatuses.QUEUED,
        });

        const internalClient = createInternalClient({
          baseUrl: fixture.config.controlPlaneApi.baseUrl,
          internalAuthServiceToken: fixture.internalAuthServiceToken,
        });

        const result = await handleConversationDelivery(
          {
            db: database.db,
            startSandboxProfileInstance: (payload) =>
              internalClient.startSandboxProfileInstance(payload),
            getSandboxInstance: (payload) => internalClient.getSandboxInstance(payload),
            mintSandboxConnectionToken: (payload) =>
              internalClient.mintSandboxConnectionToken(payload),
          },
          {
            conversationId: seeded.conversationId,
            generation: 1,
          },
        );

        expect(result).toEqual({
          conversationId: seeded.conversationId,
          generation: 1,
        });

        const queuedTask = await database.db.query.conversationDeliveryTasks.findFirst({
          where: (table, { eq: whereEq }) => whereEq(table.automationRunId, seeded.automationRunId),
        });
        expect(queuedTask?.status).toBe(ConversationDeliveryTaskStatuses.IGNORED);
        expect(queuedTask?.finishedAt).not.toBeNull();

        const automationRun = await database.db.query.automationRuns.findFirst({
          where: (table, { eq: whereEq }) => whereEq(table.id, seeded.automationRunId),
        });
        expect(automationRun?.status).toBe(AutomationRunStatuses.IGNORED);
        expect(automationRun?.finishedAt).not.toBeNull();

        const processor = await database.db.query.conversationDeliveryProcessors.findFirst({
          where: (table, { eq: whereEq }) => whereEq(table.conversationId, seeded.conversationId),
        });
        expect(processor?.status).toBe(ConversationDeliveryProcessorStatuses.IDLE);
        expect(processor?.activeWorkflowRunId).toBeNull();
      } finally {
        await database.stop();
      }
    },
    TestTimeoutMs,
  );

  it(
    "fails interrupted processing tasks instead of redelivering them",
    async ({ fixture }) => {
      const database = await createTestDatabase({
        databaseUrl: fixture.config.workflow.databaseUrl,
      });

      try {
        const seeded = await seedConversationDeliveryBase({
          database,
          suffix: "worker_conversation_delivery_processing",
        });
        await database.db.insert(conversationDeliveryTasks).values({
          id: "cdt_worker_conversation_delivery_processing",
          conversationId: seeded.conversationId,
          automationRunId: seeded.automationRunId,
          sourceWebhookEventId: seeded.webhookEventId,
          sourceOrderKey: "2026-03-08T09:00:00Z#00000000000000002000",
          status: ConversationDeliveryTaskStatuses.PROCESSING,
          startedAt: "2026-03-08T09:00:05Z",
        });

        const internalClient = createInternalClient({
          baseUrl: fixture.config.controlPlaneApi.baseUrl,
          internalAuthServiceToken: fixture.internalAuthServiceToken,
        });

        await handleConversationDelivery(
          {
            db: database.db,
            startSandboxProfileInstance: (payload) =>
              internalClient.startSandboxProfileInstance(payload),
            getSandboxInstance: (payload) => internalClient.getSandboxInstance(payload),
            mintSandboxConnectionToken: (payload) =>
              internalClient.mintSandboxConnectionToken(payload),
          },
          {
            conversationId: seeded.conversationId,
            generation: 1,
          },
        );

        const task = await database.db.query.conversationDeliveryTasks.findFirst({
          where: (table, { eq: whereEq }) => whereEq(table.automationRunId, seeded.automationRunId),
        });
        expect(task?.status).toBe(ConversationDeliveryTaskStatuses.FAILED);
        expect(task?.failureCode).toBe("conversation_requires_manual_recovery");
        expect(task?.failureMessage).toContain("manual reconciliation");

        const automationRun = await database.db.query.automationRuns.findFirst({
          where: (table, { eq: whereEq }) => whereEq(table.id, seeded.automationRunId),
        });
        expect(automationRun?.status).toBe(AutomationRunStatuses.FAILED);
        expect(automationRun?.failureCode).toBe("conversation_requires_manual_recovery");

        const processor = await database.db.query.conversationDeliveryProcessors.findFirst({
          where: (table, { eq: whereEq }) => whereEq(table.conversationId, seeded.conversationId),
        });
        expect(processor?.status).toBe(ConversationDeliveryProcessorStatuses.IDLE);
      } finally {
        await database.stop();
      }
    },
    TestTimeoutMs,
  );

  it(
    "leaves newer queued work blocked after an earlier task failure",
    async ({ fixture }) => {
      const database = await createTestDatabase({
        databaseUrl: fixture.config.workflow.databaseUrl,
      });

      try {
        const seeded = await seedConversationDeliveryBase({
          database,
          suffix: "worker_conversation_delivery_blocked",
        });
        const laterWebhookEventId = "iwe_worker_conversation_delivery_blocked_later";
        const laterAutomationRunId = "aru_worker_conversation_delivery_blocked_later";

        await database.db.insert(conversationDeliveryTasks).values({
          id: "cdt_worker_conversation_delivery_blocked_failed",
          conversationId: seeded.conversationId,
          automationRunId: seeded.automationRunId,
          sourceWebhookEventId: seeded.webhookEventId,
          sourceOrderKey: "2026-03-08T09:00:00Z#00000000000000002000",
          status: ConversationDeliveryTaskStatuses.FAILED,
          failureCode: "earlier_failure",
          failureMessage: "earlier task failed",
          finishedAt: "2026-03-08T09:01:00Z",
        });
        await database.db.insert(integrationWebhookEvents).values({
          id: laterWebhookEventId,
          organizationId: seeded.organizationId,
          integrationConnectionId: seeded.connectionId,
          targetKey: seeded.targetKey,
          externalEventId: "evt_worker_conversation_delivery_blocked_later",
          externalDeliveryId: "delivery_worker_conversation_delivery_blocked_later",
          providerEventType: "issue_comment",
          eventType: "github.issue_comment.created",
          payload: {
            issue: {
              number: 1,
            },
            comment: {
              body: "later comment",
            },
          },
          status: IntegrationWebhookEventStatuses.PROCESSED,
          sourceOccurredAt: "2026-03-08T09:05:00Z",
          sourceOrderKey: "2026-03-08T09:05:00Z#00000000000000002001",
        });
        await database.db.insert(automationRuns).values({
          id: laterAutomationRunId,
          automationId: seeded.automationId,
          automationTargetId: seeded.automationTargetId,
          sourceWebhookEventId: laterWebhookEventId,
          conversationId: seeded.conversationId,
          renderedInput: "Handle later event",
          renderedConversationKey: "issue-1",
          status: AutomationRunStatuses.RUNNING,
        });
        await database.db.insert(conversationDeliveryTasks).values({
          id: "cdt_worker_conversation_delivery_blocked_queued",
          conversationId: seeded.conversationId,
          automationRunId: laterAutomationRunId,
          sourceWebhookEventId: laterWebhookEventId,
          sourceOrderKey: "2026-03-08T09:05:00Z#00000000000000002001",
          status: ConversationDeliveryTaskStatuses.QUEUED,
        });

        const internalClient = createInternalClient({
          baseUrl: fixture.config.controlPlaneApi.baseUrl,
          internalAuthServiceToken: fixture.internalAuthServiceToken,
        });

        await handleConversationDelivery(
          {
            db: database.db,
            startSandboxProfileInstance: (payload) =>
              internalClient.startSandboxProfileInstance(payload),
            getSandboxInstance: (payload) => internalClient.getSandboxInstance(payload),
            mintSandboxConnectionToken: (payload) =>
              internalClient.mintSandboxConnectionToken(payload),
          },
          {
            conversationId: seeded.conversationId,
            generation: 1,
          },
        );

        const laterTask = await database.db.query.conversationDeliveryTasks.findFirst({
          where: (table, { eq: whereEq }) => whereEq(table.automationRunId, laterAutomationRunId),
        });
        expect(laterTask?.status).toBe(ConversationDeliveryTaskStatuses.QUEUED);
        expect(laterTask?.startedAt).toBeNull();

        const laterAutomationRun = await database.db.query.automationRuns.findFirst({
          where: (table, { eq: whereEq }) => whereEq(table.id, laterAutomationRunId),
        });
        expect(laterAutomationRun?.status).toBe(AutomationRunStatuses.RUNNING);

        const processor = await database.db.query.conversationDeliveryProcessors.findFirst({
          where: (table, { eq: whereEq }) => whereEq(table.conversationId, seeded.conversationId),
        });
        expect(processor?.status).toBe(ConversationDeliveryProcessorStatuses.IDLE);
      } finally {
        await database.stop();
      }
    },
    TestTimeoutMs,
  );

  it(
    "fails from persisted route state instead of reloading the deleted automation target first",
    async ({ fixture }) => {
      const database = await createTestDatabase({
        databaseUrl: fixture.config.workflow.databaseUrl,
      });

      try {
        const seeded = await seedConversationDeliveryBase({
          database,
          suffix: "worker_conversation_delivery_closed_route",
        });
        await database.db.insert(conversationDeliveryTasks).values({
          id: "cdt_worker_conversation_delivery_closed_route",
          conversationId: seeded.conversationId,
          automationRunId: seeded.automationRunId,
          sourceWebhookEventId: seeded.webhookEventId,
          sourceOrderKey: "2026-03-08T09:00:00Z#00000000000000002000",
          status: ConversationDeliveryTaskStatuses.QUEUED,
        });
        await database.db.insert(conversationRoutes).values({
          id: "cvr_worker_conversation_delivery_closed_route",
          conversationId: seeded.conversationId,
          sandboxInstanceId: "sbi_worker_conversation_delivery_closed_route",
          providerConversationId: "thread_closed_route",
          providerExecutionId: null,
          providerState: null,
          status: ConversationRouteStatuses.CLOSED,
        });
        await database.db
          .delete(automationTargets)
          .where(eq(automationTargets.id, seeded.automationTargetId));

        const internalClient = createInternalClient({
          baseUrl: fixture.config.controlPlaneApi.baseUrl,
          internalAuthServiceToken: fixture.internalAuthServiceToken,
        });

        await handleConversationDelivery(
          {
            db: database.db,
            startSandboxProfileInstance: (payload) =>
              internalClient.startSandboxProfileInstance(payload),
            getSandboxInstance: (payload) => internalClient.getSandboxInstance(payload),
            mintSandboxConnectionToken: (payload) =>
              internalClient.mintSandboxConnectionToken(payload),
          },
          {
            conversationId: seeded.conversationId,
            generation: 1,
          },
        );

        const task = await database.db.query.conversationDeliveryTasks.findFirst({
          where: (table, { eq: whereEq }) => whereEq(table.automationRunId, seeded.automationRunId),
        });
        expect(task?.status).toBe(ConversationDeliveryTaskStatuses.FAILED);
        expect(task?.failureCode).toBe("conversation_route_closed");
        expect(task?.failureMessage).toContain("closed");

        const automationRun = await database.db.query.automationRuns.findFirst({
          where: (table, { eq: whereEq }) => whereEq(table.id, seeded.automationRunId),
        });
        expect(automationRun?.status).toBe(AutomationRunStatuses.FAILED);
        expect(automationRun?.failureCode).toBe("conversation_route_closed");

        const processor = await database.db.query.conversationDeliveryProcessors.findFirst({
          where: (table, { eq: whereEq }) => whereEq(table.conversationId, seeded.conversationId),
        });
        expect(processor?.status).toBe(ConversationDeliveryProcessorStatuses.IDLE);
      } finally {
        await database.stop();
      }
    },
    TestTimeoutMs,
  );
});
