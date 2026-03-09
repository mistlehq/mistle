import {
  automationTargets,
  automations,
  AutomationKinds,
  ConversationCreatedByKinds,
  ConversationOwnerKinds,
  ConversationRouteStatuses,
  ConversationStatuses,
  createControlPlaneDatabase,
  organizations,
  sandboxProfiles,
  CONTROL_PLANE_SCHEMA_NAME,
} from "@mistle/db/control-plane";
import {
  CONTROL_PLANE_MIGRATIONS_FOLDER_PATH,
  MigrationTracking,
  runControlPlaneMigrations,
} from "@mistle/db/migrator";
import { Pool } from "pg";
import { describe, expect } from "vitest";

import {
  activateConversationRoute,
  claimConversation,
  ConversationPersistenceErrorCodes,
  createConversationRoute,
  rebindConversationSandbox,
  replaceConversationBinding,
  updateConversationExecution,
} from "../src/runtime/conversations/index.js";
import { it } from "./test-context.js";

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

async function seedConversationScope(input: {
  db: ReturnType<typeof createControlPlaneDatabase>;
  suffix: string;
}) {
  const organizationId = `org_cpw_conversation_${input.suffix}`;
  const sandboxProfileId = `sbp_cpw_conversation_${input.suffix}`;
  const automationId = `atm_cpw_conversation_${input.suffix}`;
  const automationTargetId = `atg_cpw_conversation_${input.suffix}`;

  await input.db.insert(organizations).values({
    id: organizationId,
    name: `Conversation Scope ${input.suffix}`,
    slug: `conversation-scope-${input.suffix}`,
  });
  await input.db.insert(sandboxProfiles).values({
    id: sandboxProfileId,
    organizationId,
    displayName: `Conversation Profile ${input.suffix}`,
    status: "active",
  });
  await input.db.insert(automations).values({
    id: automationId,
    organizationId,
    kind: AutomationKinds.WEBHOOK,
    name: `Conversation Automation ${input.suffix}`,
    enabled: true,
  });
  await input.db.insert(automationTargets).values({
    id: automationTargetId,
    automationId,
    sandboxProfileId,
    sandboxProfileVersion: 1,
  });

  return {
    organizationId,
    sandboxProfileId,
    automationId,
    automationTargetId,
  };
}

describe("conversation persistence integration", () => {
  it("claiming a new conversation inserts one pending conversation row", async ({ fixture }) => {
    const database = await createTestDatabase({
      databaseUrl: fixture.config.workflow.databaseUrl,
    });

    try {
      const scope = await seedConversationScope({
        db: database.db,
        suffix: "claim-new",
      });

      const claimedConversation = await claimConversation(
        { db: database.db },
        {
          organizationId: scope.organizationId,
          ownerKind: ConversationOwnerKinds.AUTOMATION_TARGET,
          ownerId: scope.automationTargetId,
          createdByKind: ConversationCreatedByKinds.WEBHOOK,
          createdById: scope.automationId,
          conversationKey: "key-claim-new",
          sandboxProfileId: scope.sandboxProfileId,
          integrationFamilyId: "openai",
          preview: "First conversation message",
        },
      );

      expect(claimedConversation.id.startsWith("cnv_")).toBe(true);
      expect(claimedConversation.status).toBe(ConversationStatuses.PENDING);
      expect(claimedConversation.preview).toBe("First conversation message");

      const persistedConversation = await database.db.query.conversations.findFirst({
        where: (table, { eq }) => eq(table.id, claimedConversation.id),
      });
      expect(persistedConversation).toBeDefined();
      if (persistedConversation === undefined) {
        throw new Error("Expected a persisted conversation row.");
      }
      expect(persistedConversation.status).toBe(ConversationStatuses.PENDING);
    } finally {
      await database.stop();
    }
  });

  it("claiming the same conversation twice returns the same row and does not duplicate", async ({
    fixture,
  }) => {
    const database = await createTestDatabase({
      databaseUrl: fixture.config.workflow.databaseUrl,
    });

    try {
      const scope = await seedConversationScope({
        db: database.db,
        suffix: "claim-twice",
      });

      const firstClaim = await claimConversation(
        { db: database.db },
        {
          organizationId: scope.organizationId,
          ownerKind: ConversationOwnerKinds.AUTOMATION_TARGET,
          ownerId: scope.automationTargetId,
          createdByKind: ConversationCreatedByKinds.WEBHOOK,
          createdById: scope.automationId,
          conversationKey: "key-claim-twice",
          sandboxProfileId: scope.sandboxProfileId,
          integrationFamilyId: "openai",
          preview: "Initial message",
        },
      );
      const secondClaim = await claimConversation(
        { db: database.db },
        {
          organizationId: scope.organizationId,
          ownerKind: ConversationOwnerKinds.AUTOMATION_TARGET,
          ownerId: scope.automationTargetId,
          createdByKind: ConversationCreatedByKinds.WEBHOOK,
          createdById: scope.automationId,
          conversationKey: "key-claim-twice",
          sandboxProfileId: scope.sandboxProfileId,
          integrationFamilyId: "openai",
          preview: "Initial message",
        },
      );

      expect(secondClaim.id).toBe(firstClaim.id);

      const matchingRows = await database.db.query.conversations.findMany({
        where: (table, { and, eq }) =>
          and(
            eq(table.organizationId, scope.organizationId),
            eq(table.ownerKind, ConversationOwnerKinds.AUTOMATION_TARGET),
            eq(table.ownerId, scope.automationTargetId),
            eq(table.conversationKey, "key-claim-twice"),
          ),
      });
      expect(matchingRows).toHaveLength(1);
    } finally {
      await database.stop();
    }
  });

  it("claiming an integration-binding conversation generates conversation key from conversation id", async ({
    fixture,
  }) => {
    const database = await createTestDatabase({
      databaseUrl: fixture.config.workflow.databaseUrl,
    });

    try {
      const scope = await seedConversationScope({
        db: database.db,
        suffix: "claim-integration-binding",
      });

      const claimedConversation = await claimConversation(
        { db: database.db },
        {
          organizationId: scope.organizationId,
          ownerKind: ConversationOwnerKinds.INTEGRATION_BINDING,
          ownerId: "ibd_cpw_conversation_claim_integration_binding",
          createdByKind: ConversationCreatedByKinds.USER,
          createdById: "usr_cpw_conversation_claim_integration_binding",
          sandboxProfileId: scope.sandboxProfileId,
          integrationFamilyId: "openai",
          preview: "Dashboard message",
        },
      );

      expect(claimedConversation.id.startsWith("cnv_")).toBe(true);
      expect(claimedConversation.conversationKey).toBe(claimedConversation.id);
    } finally {
      await database.stop();
    }
  });

  it("claiming a conversation rejects non-null title at creation time", async ({ fixture }) => {
    const database = await createTestDatabase({
      databaseUrl: fixture.config.workflow.databaseUrl,
    });

    try {
      const scope = await seedConversationScope({
        db: database.db,
        suffix: "claim-title",
      });

      await expect(
        claimConversation(
          { db: database.db },
          {
            organizationId: scope.organizationId,
            ownerKind: ConversationOwnerKinds.AUTOMATION_TARGET,
            ownerId: scope.automationTargetId,
            createdByKind: ConversationCreatedByKinds.WEBHOOK,
            createdById: scope.automationId,
            conversationKey: "key-claim-title",
            sandboxProfileId: scope.sandboxProfileId,
            integrationFamilyId: "openai",
            title: "Should be rejected",
            preview: "Initial message",
          },
        ),
      ).rejects.toMatchObject({
        code: ConversationPersistenceErrorCodes.CONVERSATION_TITLE_MUST_BE_NULL,
      });
    } finally {
      await database.stop();
    }
  });

  it("claiming a conversation truncates preview to at most 160 Unicode code units", async ({
    fixture,
  }) => {
    const database = await createTestDatabase({
      databaseUrl: fixture.config.workflow.databaseUrl,
    });

    try {
      const scope = await seedConversationScope({
        db: database.db,
        suffix: "claim-preview-truncate",
      });
      const longPreview = "x".repeat(170);

      const claimedConversation = await claimConversation(
        { db: database.db },
        {
          organizationId: scope.organizationId,
          ownerKind: ConversationOwnerKinds.AUTOMATION_TARGET,
          ownerId: scope.automationTargetId,
          createdByKind: ConversationCreatedByKinds.WEBHOOK,
          createdById: scope.automationId,
          conversationKey: "key-claim-preview-truncate",
          sandboxProfileId: scope.sandboxProfileId,
          integrationFamilyId: "openai",
          preview: longPreview,
        },
      );

      expect(claimedConversation.preview).toHaveLength(160);
      expect(claimedConversation.preview).toBe(longPreview.slice(0, 160));
    } finally {
      await database.stop();
    }
  });

  it("creating a route for a conversation inserts one active route row", async ({ fixture }) => {
    const database = await createTestDatabase({
      databaseUrl: fixture.config.workflow.databaseUrl,
    });

    try {
      const scope = await seedConversationScope({
        db: database.db,
        suffix: "create-route",
      });
      const claimedConversation = await claimConversation(
        { db: database.db },
        {
          organizationId: scope.organizationId,
          ownerKind: ConversationOwnerKinds.AUTOMATION_TARGET,
          ownerId: scope.automationTargetId,
          createdByKind: ConversationCreatedByKinds.WEBHOOK,
          createdById: scope.automationId,
          conversationKey: "key-create-route",
          sandboxProfileId: scope.sandboxProfileId,
          integrationFamilyId: "openai",
          preview: "Create route message",
        },
      );

      const createdRoute = await createConversationRoute(
        { db: database.db },
        {
          conversationId: claimedConversation.id,
          sandboxInstanceId: "sbi_create_route_1",
        },
      );

      expect(createdRoute.id.startsWith("cvr_")).toBe(true);
      expect(createdRoute.status).toBe(ConversationRouteStatuses.ACTIVE);
      expect(createdRoute.providerConversationId).toBeNull();
      expect(createdRoute.providerExecutionId).toBeNull();
    } finally {
      await database.stop();
    }
  });

  it("activating a pending conversation stores provider conversation and execution identifiers", async ({
    fixture,
  }) => {
    const database = await createTestDatabase({
      databaseUrl: fixture.config.workflow.databaseUrl,
    });

    try {
      const scope = await seedConversationScope({
        db: database.db,
        suffix: "activate",
      });
      const claimedConversation = await claimConversation(
        { db: database.db },
        {
          organizationId: scope.organizationId,
          ownerKind: ConversationOwnerKinds.AUTOMATION_TARGET,
          ownerId: scope.automationTargetId,
          createdByKind: ConversationCreatedByKinds.WEBHOOK,
          createdById: scope.automationId,
          conversationKey: "key-activate",
          sandboxProfileId: scope.sandboxProfileId,
          integrationFamilyId: "openai",
          preview: "Activate message",
        },
      );
      const createdRoute = await createConversationRoute(
        { db: database.db },
        {
          conversationId: claimedConversation.id,
          sandboxInstanceId: "sbi_activate_1",
        },
      );

      const activatedRoute = await activateConversationRoute(
        { db: database.db },
        {
          conversationId: claimedConversation.id,
          routeId: createdRoute.id,
          sandboxInstanceId: "sbi_activate_1",
          providerConversationId: "thread_activate_1",
          providerExecutionId: "turn_activate_1",
          providerState: {
            phase: "active",
          },
        },
      );

      expect(activatedRoute.providerConversationId).toBe("thread_activate_1");
      expect(activatedRoute.providerExecutionId).toBe("turn_activate_1");
      expect(activatedRoute.providerState).toEqual({
        phase: "active",
      });

      const persistedConversation = await database.db.query.conversations.findFirst({
        where: (table, { eq }) => eq(table.id, claimedConversation.id),
      });
      expect(persistedConversation).toBeDefined();
      if (persistedConversation === undefined) {
        throw new Error("Expected conversation to exist after activation.");
      }
      expect(persistedConversation.status).toBe(ConversationStatuses.ACTIVE);
    } finally {
      await database.stop();
    }
  });

  it("rebinding sandbox updates sandbox instance id and clears execution id", async ({
    fixture,
  }) => {
    const database = await createTestDatabase({
      databaseUrl: fixture.config.workflow.databaseUrl,
    });

    try {
      const scope = await seedConversationScope({
        db: database.db,
        suffix: "rebind",
      });
      const claimedConversation = await claimConversation(
        { db: database.db },
        {
          organizationId: scope.organizationId,
          ownerKind: ConversationOwnerKinds.AUTOMATION_TARGET,
          ownerId: scope.automationTargetId,
          createdByKind: ConversationCreatedByKinds.WEBHOOK,
          createdById: scope.automationId,
          conversationKey: "key-rebind",
          sandboxProfileId: scope.sandboxProfileId,
          integrationFamilyId: "openai",
          preview: "Rebind message",
        },
      );
      const createdRoute = await createConversationRoute(
        { db: database.db },
        {
          conversationId: claimedConversation.id,
          sandboxInstanceId: "sbi_rebind_1",
        },
      );
      await activateConversationRoute(
        { db: database.db },
        {
          conversationId: claimedConversation.id,
          routeId: createdRoute.id,
          sandboxInstanceId: "sbi_rebind_1",
          providerConversationId: "thread_rebind_1",
          providerExecutionId: "turn_rebind_1",
        },
      );

      const reboundRoute = await rebindConversationSandbox(
        { db: database.db },
        {
          routeId: createdRoute.id,
          sandboxInstanceId: "sbi_rebind_2",
        },
      );

      expect(reboundRoute.sandboxInstanceId).toBe("sbi_rebind_2");
      expect(reboundRoute.providerExecutionId).toBeNull();
      expect(reboundRoute.providerConversationId).toBe("thread_rebind_1");
    } finally {
      await database.stop();
    }
  });

  it("replacing binding updates sandbox instance id and provider conversation id", async ({
    fixture,
  }) => {
    const database = await createTestDatabase({
      databaseUrl: fixture.config.workflow.databaseUrl,
    });

    try {
      const scope = await seedConversationScope({
        db: database.db,
        suffix: "replace",
      });
      const claimedConversation = await claimConversation(
        { db: database.db },
        {
          organizationId: scope.organizationId,
          ownerKind: ConversationOwnerKinds.AUTOMATION_TARGET,
          ownerId: scope.automationTargetId,
          createdByKind: ConversationCreatedByKinds.WEBHOOK,
          createdById: scope.automationId,
          conversationKey: "key-replace",
          sandboxProfileId: scope.sandboxProfileId,
          integrationFamilyId: "openai",
          preview: "Replace message",
        },
      );
      const createdRoute = await createConversationRoute(
        { db: database.db },
        {
          conversationId: claimedConversation.id,
          sandboxInstanceId: "sbi_replace_1",
        },
      );
      await activateConversationRoute(
        { db: database.db },
        {
          conversationId: claimedConversation.id,
          routeId: createdRoute.id,
          sandboxInstanceId: "sbi_replace_1",
          providerConversationId: "thread_replace_1",
          providerExecutionId: "turn_replace_1",
        },
      );

      const replacedRoute = await replaceConversationBinding(
        { db: database.db },
        {
          routeId: createdRoute.id,
          sandboxInstanceId: "sbi_replace_2",
          providerConversationId: "thread_replace_2",
          providerExecutionId: "turn_replace_2",
          providerState: {
            generation: 2,
          },
        },
      );

      expect(replacedRoute.sandboxInstanceId).toBe("sbi_replace_2");
      expect(replacedRoute.providerConversationId).toBe("thread_replace_2");
      expect(replacedRoute.providerExecutionId).toBe("turn_replace_2");
      expect(replacedRoute.providerState).toEqual({
        generation: 2,
      });
    } finally {
      await database.stop();
    }
  });

  it("updating execution updates only provider execution state", async ({ fixture }) => {
    const database = await createTestDatabase({
      databaseUrl: fixture.config.workflow.databaseUrl,
    });

    try {
      const scope = await seedConversationScope({
        db: database.db,
        suffix: "update-execution",
      });
      const claimedConversation = await claimConversation(
        { db: database.db },
        {
          organizationId: scope.organizationId,
          ownerKind: ConversationOwnerKinds.AUTOMATION_TARGET,
          ownerId: scope.automationTargetId,
          createdByKind: ConversationCreatedByKinds.WEBHOOK,
          createdById: scope.automationId,
          conversationKey: "key-update-execution",
          sandboxProfileId: scope.sandboxProfileId,
          integrationFamilyId: "openai",
          preview: "Update execution message",
        },
      );
      const createdRoute = await createConversationRoute(
        { db: database.db },
        {
          conversationId: claimedConversation.id,
          sandboxInstanceId: "sbi_update_execution_1",
        },
      );
      await activateConversationRoute(
        { db: database.db },
        {
          conversationId: claimedConversation.id,
          routeId: createdRoute.id,
          sandboxInstanceId: "sbi_update_execution_1",
          providerConversationId: "thread_update_execution_1",
          providerExecutionId: "turn_update_execution_1",
          providerState: {
            cursor: "alpha",
          },
        },
      );

      const routeBeforeUpdate = await database.db.query.conversationRoutes.findFirst({
        where: (table, { eq }) => eq(table.id, createdRoute.id),
      });
      const conversationBeforeUpdate = await database.db.query.conversations.findFirst({
        where: (table, { eq }) => eq(table.id, claimedConversation.id),
      });
      if (routeBeforeUpdate === undefined || conversationBeforeUpdate === undefined) {
        throw new Error("Expected persisted route and conversation before execution update.");
      }

      const updatedRoute = await updateConversationExecution(
        { db: database.db },
        {
          routeId: createdRoute.id,
          providerExecutionId: "turn_update_execution_2",
        },
      );

      expect(updatedRoute.providerExecutionId).toBe("turn_update_execution_2");
      expect(updatedRoute.providerConversationId).toBe(routeBeforeUpdate.providerConversationId);
      expect(updatedRoute.sandboxInstanceId).toBe(routeBeforeUpdate.sandboxInstanceId);
      expect(updatedRoute.providerState).toEqual(routeBeforeUpdate.providerState);

      const conversationAfterUpdate = await database.db.query.conversations.findFirst({
        where: (table, { eq }) => eq(table.id, claimedConversation.id),
      });
      if (conversationAfterUpdate === undefined) {
        throw new Error("Expected conversation after execution update.");
      }
      expect(conversationAfterUpdate.lastActivityAt).not.toBe(
        conversationBeforeUpdate.lastActivityAt,
      );
      expect(conversationAfterUpdate.title).toBe(conversationBeforeUpdate.title);
      expect(conversationAfterUpdate.preview).toBe(conversationBeforeUpdate.preview);
    } finally {
      await database.stop();
    }
  });
});
