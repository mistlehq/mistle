import {
  AutomationConversationStatuses,
  AutomationConversationOwnerKinds,
  type AutomationConversationCreatedByKind,
  type InsertAutomationConversation,
  type AutomationConversationOwnerKind,
  type ControlPlaneDatabase,
  type ControlPlaneTransaction,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";
import { typeid } from "typeid-js";

import {
  AutomationConversationPersistenceError,
  AutomationConversationPersistenceErrorCodes,
} from "./automation-conversation-persistence-error.js";
export type ClaimAutomationConversationInput = {
  organizationId: string;
  ownerKind: AutomationConversationOwnerKind;
  ownerId: string;
  createdByKind: AutomationConversationCreatedByKind;
  createdById: string;
  conversationKey?: string;
  sandboxProfileId: string;
  integrationFamilyId: string;
  runtimeId: string;
};

export async function claimAutomationConversation(
  ctx: {
    db: ControlPlaneDatabase | ControlPlaneTransaction;
  },
  input: ClaimAutomationConversationInput,
) {
  const tables = getControlPlaneDatabaseSchema(ctx.db);

  const resolvedConversationId =
    input.ownerKind === AutomationConversationOwnerKinds.INTEGRATION_BINDING
      ? typeid("cnv").toString()
      : undefined;
  const resolvedConversationKey =
    input.ownerKind === AutomationConversationOwnerKinds.INTEGRATION_BINDING
      ? resolvedConversationId
      : input.conversationKey;
  if (resolvedConversationKey === undefined) {
    throw new AutomationConversationPersistenceError({
      code: AutomationConversationPersistenceErrorCodes.CONVERSATION_KEY_REQUIRED,
      message: "conversationKey is required for non-dashboard conversation claims.",
    });
  }
  if (
    input.ownerKind === AutomationConversationOwnerKinds.INTEGRATION_BINDING &&
    input.conversationKey !== undefined
  ) {
    throw new AutomationConversationPersistenceError({
      code: AutomationConversationPersistenceErrorCodes.CONVERSATION_KEY_FORBIDDEN,
      message:
        "conversationKey must not be provided for integration-binding claims because it must match the generated conversation id.",
    });
  }

  const insertValues: InsertAutomationConversation = {
    id: resolvedConversationId,
    organizationId: input.organizationId,
    ownerKind: input.ownerKind,
    ownerId: input.ownerId,
    createdByKind: input.createdByKind,
    createdById: input.createdById,
    conversationKey: resolvedConversationKey,
    sandboxProfileId: input.sandboxProfileId,
    integrationFamilyId: input.integrationFamilyId,
    runtimeId: input.runtimeId,
    status: AutomationConversationStatuses.PENDING,
  };

  const insertedRows = await ctx.db
    .insert(tables.automationConversations)
    .values(insertValues)
    .onConflictDoNothing({
      target: [
        tables.automationConversations.organizationId,
        tables.automationConversations.ownerKind,
        tables.automationConversations.ownerId,
        tables.automationConversations.conversationKey,
      ],
    })
    .returning();
  const insertedAutomationConversation = insertedRows[0];
  if (insertedAutomationConversation !== undefined) {
    return insertedAutomationConversation;
  }

  const existingAutomationConversation = await ctx.db.query.automationConversations.findFirst({
    where: (table, { and, eq }) =>
      and(
        eq(table.organizationId, input.organizationId),
        eq(table.ownerKind, input.ownerKind),
        eq(table.ownerId, input.ownerId),
        eq(table.conversationKey, resolvedConversationKey),
      ),
  });
  if (existingAutomationConversation === undefined) {
    throw new AutomationConversationPersistenceError({
      code: AutomationConversationPersistenceErrorCodes.CONVERSATION_NOT_FOUND,
      message:
        "AutomationConversation claim conflict occurred but no existing conversation record could be loaded.",
    });
  }

  if (existingAutomationConversation.status === AutomationConversationStatuses.CLOSED) {
    throw new AutomationConversationPersistenceError({
      code: AutomationConversationPersistenceErrorCodes.CONVERSATION_CLOSED,
      message: `AutomationConversation '${existingAutomationConversation.id}' is closed and cannot be claimed.`,
    });
  }

  return existingAutomationConversation;
}
