import {
  TriggerConversationStatuses,
  TriggerConversationOwnerKinds,
  type TriggerConversationCreatedByKind,
  type InsertTriggerConversation,
  type TriggerConversationOwnerKind,
  type ControlPlaneDatabase,
  type ControlPlaneTransaction,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";
import { typeid } from "typeid-js";

import {
  TriggerConversationPersistenceError,
  TriggerConversationPersistenceErrorCodes,
} from "./trigger-conversation-persistence-error.js";
export type ClaimTriggerConversationInput = {
  organizationId: string;
  ownerKind: TriggerConversationOwnerKind;
  ownerId: string;
  createdByKind: TriggerConversationCreatedByKind;
  createdById: string;
  conversationKey?: string;
  sandboxProfileId: string;
  integrationFamilyId: string;
  runtimeId: string;
};

export async function claimTriggerConversation(
  ctx: {
    db: ControlPlaneDatabase | ControlPlaneTransaction;
  },
  input: ClaimTriggerConversationInput,
) {
  const tables = getControlPlaneDatabaseSchema(ctx.db);

  const resolvedConversationId =
    input.ownerKind === TriggerConversationOwnerKinds.INTEGRATION_BINDING
      ? typeid("cnv").toString()
      : undefined;
  const resolvedConversationKey =
    input.ownerKind === TriggerConversationOwnerKinds.INTEGRATION_BINDING
      ? resolvedConversationId
      : input.conversationKey;
  if (resolvedConversationKey === undefined) {
    throw new TriggerConversationPersistenceError({
      code: TriggerConversationPersistenceErrorCodes.CONVERSATION_KEY_REQUIRED,
      message: "conversationKey is required for non-dashboard conversation claims.",
    });
  }
  if (
    input.ownerKind === TriggerConversationOwnerKinds.INTEGRATION_BINDING &&
    input.conversationKey !== undefined
  ) {
    throw new TriggerConversationPersistenceError({
      code: TriggerConversationPersistenceErrorCodes.CONVERSATION_KEY_FORBIDDEN,
      message:
        "conversationKey must not be provided for integration-binding claims because it must match the generated conversation id.",
    });
  }

  const insertValues: InsertTriggerConversation = {
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
    status: TriggerConversationStatuses.PENDING,
  };

  const insertedRows = await ctx.db
    .insert(tables.triggerConversations)
    .values(insertValues)
    .onConflictDoNothing({
      target: [
        tables.triggerConversations.organizationId,
        tables.triggerConversations.ownerKind,
        tables.triggerConversations.ownerId,
        tables.triggerConversations.conversationKey,
      ],
    })
    .returning();
  const insertedTriggerConversation = insertedRows[0];
  if (insertedTriggerConversation !== undefined) {
    return insertedTriggerConversation;
  }

  const existingTriggerConversation = await ctx.db.query.triggerConversations.findFirst({
    where: (table, { and, eq }) =>
      and(
        eq(table.organizationId, input.organizationId),
        eq(table.ownerKind, input.ownerKind),
        eq(table.ownerId, input.ownerId),
        eq(table.conversationKey, resolvedConversationKey),
      ),
  });
  if (existingTriggerConversation === undefined) {
    throw new TriggerConversationPersistenceError({
      code: TriggerConversationPersistenceErrorCodes.CONVERSATION_NOT_FOUND,
      message:
        "TriggerConversation claim conflict occurred but no existing conversation record could be loaded.",
    });
  }

  if (existingTriggerConversation.status === TriggerConversationStatuses.CLOSED) {
    throw new TriggerConversationPersistenceError({
      code: TriggerConversationPersistenceErrorCodes.CONVERSATION_CLOSED,
      message: `TriggerConversation '${existingTriggerConversation.id}' is closed and cannot be claimed.`,
    });
  }

  return existingTriggerConversation;
}
