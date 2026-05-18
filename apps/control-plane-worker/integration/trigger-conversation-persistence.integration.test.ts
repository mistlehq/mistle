/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { randomUUID } from "node:crypto";

import {
  TriggerConversationCreatedByKinds,
  TriggerConversationOwnerKinds,
  TriggerConversationRouteStatuses,
  TriggerConversationStatuses,
  TriggerKinds,
} from "@mistle/db/control-plane";
import {
  createIntegrationTest,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import { activateTriggerConversationRoute } from "../openworkflow/shared/activate-conversation-route.js";
import { claimTriggerConversation } from "../openworkflow/shared/claim-conversation.js";
import { createTriggerConversationRoute } from "../openworkflow/shared/create-conversation-route.js";
import { rebindTriggerConversationSandbox } from "../openworkflow/shared/rebind-conversation-sandbox.js";
import { replaceTriggerConversationBinding } from "../openworkflow/shared/replace-conversation-binding.js";
import { updateTriggerConversationExecution } from "../openworkflow/shared/update-conversation-execution.js";

const it = createIntegrationTest({
  services: ["control-plane-worker"],
});

describe.concurrent("control-plane worker conversation persistence", () => {
  it("claims a new pending trigger conversation", async ({ env }) => {
    const scope = await seedConversationScope({
      env,
      suffix: createSuffix("claim_new"),
    });

    const claimedConversation = await claimTriggerConversation(
      { db: env.controlPlaneDb },
      {
        organizationId: scope.organizationId,
        ownerKind: TriggerConversationOwnerKinds.TRIGGER_TARGET,
        ownerId: scope.triggerTargetId,
        createdByKind: TriggerConversationCreatedByKinds.WEBHOOK,
        createdById: scope.triggerId,
        conversationKey: "key-claim-new",
        sandboxProfileId: scope.sandboxProfileId,
        integrationFamilyId: "openai",
        runtimeId: "codex",
      },
    );

    expect(claimedConversation.id.startsWith("cnv_")).toBe(true);
    expect(claimedConversation.status).toBe(TriggerConversationStatuses.PENDING);

    const persistedConversation = await env.controlPlaneDb.query.triggerConversations.findFirst({
      where: (table, { eq }) => eq(table.id, claimedConversation.id),
    });
    expect(persistedConversation).toEqual(
      expect.objectContaining({
        id: claimedConversation.id,
        status: TriggerConversationStatuses.PENDING,
      }),
    );
  });

  it("reuses an existing matching conversation claim without duplicating rows", async ({ env }) => {
    const scope = await seedConversationScope({
      env,
      suffix: createSuffix("claim_twice"),
    });

    const firstClaim = await claimTriggerConversation(
      { db: env.controlPlaneDb },
      {
        organizationId: scope.organizationId,
        ownerKind: TriggerConversationOwnerKinds.TRIGGER_TARGET,
        ownerId: scope.triggerTargetId,
        createdByKind: TriggerConversationCreatedByKinds.WEBHOOK,
        createdById: scope.triggerId,
        conversationKey: "key-claim-twice",
        sandboxProfileId: scope.sandboxProfileId,
        integrationFamilyId: "openai",
        runtimeId: "codex",
      },
    );
    const secondClaim = await claimTriggerConversation(
      { db: env.controlPlaneDb },
      {
        organizationId: scope.organizationId,
        ownerKind: TriggerConversationOwnerKinds.TRIGGER_TARGET,
        ownerId: scope.triggerTargetId,
        createdByKind: TriggerConversationCreatedByKinds.WEBHOOK,
        createdById: scope.triggerId,
        conversationKey: "key-claim-twice",
        sandboxProfileId: scope.sandboxProfileId,
        integrationFamilyId: "openai",
        runtimeId: "codex",
      },
    );

    expect(secondClaim.id).toBe(firstClaim.id);

    const matchingRows = await env.controlPlaneDb.query.triggerConversations.findMany({
      where: (table, { and, eq }) =>
        and(
          eq(table.organizationId, scope.organizationId),
          eq(table.ownerKind, TriggerConversationOwnerKinds.TRIGGER_TARGET),
          eq(table.ownerId, scope.triggerTargetId),
          eq(table.conversationKey, "key-claim-twice"),
        ),
    });
    expect(matchingRows).toHaveLength(1);
  });

  it("uses the generated conversation id as the key for integration-binding conversations", async ({
    env,
  }) => {
    const scope = await seedConversationScope({
      env,
      suffix: createSuffix("claim_binding"),
    });

    const claimedConversation = await claimTriggerConversation(
      { db: env.controlPlaneDb },
      {
        organizationId: scope.organizationId,
        ownerKind: TriggerConversationOwnerKinds.INTEGRATION_BINDING,
        ownerId: `ibd_${scope.suffix}`,
        createdByKind: TriggerConversationCreatedByKinds.USER,
        createdById: `usr_${scope.suffix}`,
        sandboxProfileId: scope.sandboxProfileId,
        integrationFamilyId: "openai",
        runtimeId: "codex",
      },
    );

    expect(claimedConversation.id.startsWith("cnv_")).toBe(true);
    expect(claimedConversation.conversationKey).toBe(claimedConversation.id);
  });

  it("creates one active route for a conversation", async ({ env }) => {
    const claimedConversation = await claimTargetConversation({
      env,
      suffix: createSuffix("create_route"),
      conversationKey: "key-create-route",
    });

    const route = await createTriggerConversationRoute(
      { db: env.controlPlaneDb },
      {
        conversationId: claimedConversation.id,
        sandboxInstanceId: "sbi_create_route_1",
      },
    );

    expect(route.id.startsWith("cvr_")).toBe(true);
    expect(route.status).toBe(TriggerConversationRouteStatuses.ACTIVE);
    expect(route.providerConversationId).toBeNull();
    expect(route.providerExecutionId).toBeNull();
  });

  it("activates a pending route with provider conversation state", async ({ env }) => {
    const claimedConversation = await claimTargetConversation({
      env,
      suffix: createSuffix("activate"),
      conversationKey: "key-activate",
    });
    const route = await createTriggerConversationRoute(
      { db: env.controlPlaneDb },
      {
        conversationId: claimedConversation.id,
        sandboxInstanceId: "sbi_activate_1",
      },
    );

    const activatedRoute = await activateTriggerConversationRoute(
      { db: env.controlPlaneDb },
      {
        conversationId: claimedConversation.id,
        routeId: route.id,
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

    const persistedConversation = await env.controlPlaneDb.query.triggerConversations.findFirst({
      where: (table, { eq }) => eq(table.id, claimedConversation.id),
    });
    expect(persistedConversation?.status).toBe(TriggerConversationStatuses.ACTIVE);
  });

  it("rebinds a route to a new sandbox and clears only the execution id", async ({ env }) => {
    const route = await createActiveRoute({
      env,
      suffix: createSuffix("rebind"),
      conversationKey: "key-rebind",
      sandboxInstanceId: "sbi_rebind_1",
      providerConversationId: "thread_rebind_1",
      providerExecutionId: "turn_rebind_1",
    });

    const reboundRoute = await rebindTriggerConversationSandbox(
      { db: env.controlPlaneDb },
      {
        routeId: route.id,
        sandboxInstanceId: "sbi_rebind_2",
      },
    );

    expect(reboundRoute.sandboxInstanceId).toBe("sbi_rebind_2");
    expect(reboundRoute.providerExecutionId).toBeNull();
    expect(reboundRoute.providerConversationId).toBe("thread_rebind_1");
  });

  it("replaces a route binding with new sandbox and provider identifiers", async ({ env }) => {
    const route = await createActiveRoute({
      env,
      suffix: createSuffix("replace"),
      conversationKey: "key-replace",
      sandboxInstanceId: "sbi_replace_1",
      providerConversationId: "thread_replace_1",
      providerExecutionId: "turn_replace_1",
    });

    const replacedRoute = await replaceTriggerConversationBinding(
      { db: env.controlPlaneDb },
      {
        routeId: route.id,
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
  });

  it("updates execution state without changing the route binding", async ({ env }) => {
    const { conversation, route } = await createActiveConversationRoute({
      env,
      suffix: createSuffix("update_execution"),
      conversationKey: "key-update-execution",
      sandboxInstanceId: "sbi_update_execution_1",
      providerConversationId: "thread_update_execution_1",
      providerExecutionId: "turn_update_execution_1",
      providerState: {
        cursor: "alpha",
      },
    });
    const conversationBeforeUpdate = await env.controlPlaneDb.query.triggerConversations.findFirst({
      where: (table, { eq }) => eq(table.id, conversation.id),
    });
    if (conversationBeforeUpdate === undefined) {
      throw new Error("Expected conversation before execution update.");
    }

    const updatedRoute = await updateTriggerConversationExecution(
      { db: env.controlPlaneDb },
      {
        routeId: route.id,
        providerExecutionId: "turn_update_execution_2",
      },
    );

    expect(updatedRoute.providerExecutionId).toBe("turn_update_execution_2");
    expect(updatedRoute.providerConversationId).toBe(route.providerConversationId);
    expect(updatedRoute.sandboxInstanceId).toBe(route.sandboxInstanceId);
    expect(updatedRoute.providerState).toEqual(route.providerState);

    const conversationAfterUpdate = await env.controlPlaneDb.query.triggerConversations.findFirst({
      where: (table, { eq }) => eq(table.id, conversation.id),
    });
    expect(conversationAfterUpdate?.lastActivityAt).not.toBe(
      conversationBeforeUpdate.lastActivityAt,
    );
  });
});

function createSuffix(label: string): string {
  return `${label}_${randomUUID().replaceAll("-", "_")}`;
}

async function seedConversationScope(input: {
  env: IntegrationTestEnvironment;
  suffix: string;
}): Promise<{
  suffix: string;
  organizationId: string;
  sandboxProfileId: string;
  triggerId: string;
  triggerTargetId: string;
}> {
  const organizationId = `org_cpw_conversation_${input.suffix}`;
  const sandboxProfileId = `sbp_cpw_conversation_${input.suffix}`;
  const triggerId = `atm_cpw_conversation_${input.suffix}`;
  const triggerTargetId = `atg_cpw_conversation_${input.suffix}`;

  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.organizations).values({
    id: organizationId,
    name: `Trigger Conversation ${input.suffix}`,
    slug: `trigger-conversation-${input.suffix}`,
  });
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.sandboxProfiles).values({
    id: sandboxProfileId,
    organizationId,
    displayName: `Trigger Conversation Profile ${input.suffix}`,
    status: "active",
  });
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.triggers).values({
    id: triggerId,
    organizationId,
    kind: TriggerKinds.WEBHOOK,
    name: `Trigger Conversation ${input.suffix}`,
    enabled: true,
  });
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.triggerTargets).values({
    id: triggerTargetId,
    triggerId,
    sandboxProfileId,
    sandboxProfileVersion: 1,
  });

  return {
    suffix: input.suffix,
    organizationId,
    sandboxProfileId,
    triggerId,
    triggerTargetId,
  };
}

async function claimTargetConversation(input: {
  env: IntegrationTestEnvironment;
  suffix: string;
  conversationKey: string;
}) {
  const scope = await seedConversationScope({
    env: input.env,
    suffix: input.suffix,
  });

  return await claimTriggerConversation(
    { db: input.env.controlPlaneDb },
    {
      organizationId: scope.organizationId,
      ownerKind: TriggerConversationOwnerKinds.TRIGGER_TARGET,
      ownerId: scope.triggerTargetId,
      createdByKind: TriggerConversationCreatedByKinds.WEBHOOK,
      createdById: scope.triggerId,
      conversationKey: input.conversationKey,
      sandboxProfileId: scope.sandboxProfileId,
      integrationFamilyId: "openai",
      runtimeId: "codex",
    },
  );
}

async function createActiveRoute(input: {
  env: IntegrationTestEnvironment;
  suffix: string;
  conversationKey: string;
  sandboxInstanceId: string;
  providerConversationId: string;
  providerExecutionId: string;
}) {
  const { route } = await createActiveConversationRoute({
    ...input,
  });

  return route;
}

async function createActiveConversationRoute(input: {
  env: IntegrationTestEnvironment;
  suffix: string;
  conversationKey: string;
  sandboxInstanceId: string;
  providerConversationId: string;
  providerExecutionId: string;
  providerState?: unknown;
}) {
  const conversation = await claimTargetConversation({
    env: input.env,
    suffix: input.suffix,
    conversationKey: input.conversationKey,
  });
  const route = await createTriggerConversationRoute(
    { db: input.env.controlPlaneDb },
    {
      conversationId: conversation.id,
      sandboxInstanceId: input.sandboxInstanceId,
    },
  );
  const activeRoute = await activateTriggerConversationRoute(
    { db: input.env.controlPlaneDb },
    {
      conversationId: conversation.id,
      routeId: route.id,
      sandboxInstanceId: input.sandboxInstanceId,
      providerConversationId: input.providerConversationId,
      providerExecutionId: input.providerExecutionId,
      providerState: input.providerState,
    },
  );

  return {
    conversation,
    route: activeRoute,
  };
}
