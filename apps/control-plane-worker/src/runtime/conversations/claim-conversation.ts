import {
  conversations,
  ConversationStatuses,
  ConversationOwnerKinds,
  type ConversationCreatedByKind,
  type InsertConversation,
  type ConversationOwnerKind,
  type ConversationProviderFamily,
} from "@mistle/db/control-plane";
import { typeid } from "typeid-js";

import { ConversationPersistenceError, ConversationPersistenceErrorCodes } from "./errors.js";
import type { ConversationPersistenceDependencies } from "./types.js";

export type ClaimConversationInput = {
  organizationId: string;
  ownerKind: ConversationOwnerKind;
  ownerId: string;
  createdByKind: ConversationCreatedByKind;
  createdById: string;
  conversationKey?: string;
  sandboxProfileId: string;
  providerFamily: ConversationProviderFamily;
  title?: string | null;
  preview?: string | null;
};

export async function claimConversation(
  deps: ConversationPersistenceDependencies,
  input: ClaimConversationInput,
) {
  if (input.title !== undefined && input.title !== null) {
    throw new ConversationPersistenceError({
      code: ConversationPersistenceErrorCodes.CONVERSATION_TITLE_MUST_BE_NULL,
      message:
        "Conversation title must be null at claim time. Titles are user-editable after creation.",
    });
  }

  const resolvedConversationId =
    input.ownerKind === ConversationOwnerKinds.INTEGRATION_BINDING
      ? typeid("cnv").toString()
      : undefined;
  const resolvedConversationKey =
    input.ownerKind === ConversationOwnerKinds.INTEGRATION_BINDING
      ? resolvedConversationId
      : input.conversationKey;
  if (resolvedConversationKey === undefined) {
    throw new ConversationPersistenceError({
      code: ConversationPersistenceErrorCodes.CONVERSATION_KEY_REQUIRED,
      message: "conversationKey is required for non-dashboard conversation claims.",
    });
  }
  if (
    input.ownerKind === ConversationOwnerKinds.INTEGRATION_BINDING &&
    input.conversationKey !== undefined
  ) {
    throw new ConversationPersistenceError({
      code: ConversationPersistenceErrorCodes.CONVERSATION_KEY_FORBIDDEN,
      message:
        "conversationKey must not be provided for integration-binding claims because it must match the generated conversation id.",
    });
  }

  const insertValues: InsertConversation = {
    id: resolvedConversationId,
    organizationId: input.organizationId,
    ownerKind: input.ownerKind,
    ownerId: input.ownerId,
    createdByKind: input.createdByKind,
    createdById: input.createdById,
    conversationKey: resolvedConversationKey,
    sandboxProfileId: input.sandboxProfileId,
    providerFamily: input.providerFamily,
    title: null,
    preview: input.preview == null ? null : input.preview.slice(0, 160),
    status: ConversationStatuses.PENDING,
  };

  const insertedRows = await deps.db
    .insert(conversations)
    .values(insertValues)
    .onConflictDoNothing({
      target: [
        conversations.organizationId,
        conversations.ownerKind,
        conversations.ownerId,
        conversations.conversationKey,
      ],
    })
    .returning();
  const insertedConversation = insertedRows[0];
  if (insertedConversation !== undefined) {
    return insertedConversation;
  }

  const existingConversation = await deps.db.query.conversations.findFirst({
    where: (table, { and, eq }) =>
      and(
        eq(table.organizationId, input.organizationId),
        eq(table.ownerKind, input.ownerKind),
        eq(table.ownerId, input.ownerId),
        eq(table.conversationKey, resolvedConversationKey),
      ),
  });
  if (existingConversation === undefined) {
    throw new ConversationPersistenceError({
      code: ConversationPersistenceErrorCodes.CONVERSATION_NOT_FOUND,
      message:
        "Conversation claim conflict occurred but no existing conversation record could be loaded.",
    });
  }

  if (existingConversation.status === ConversationStatuses.CLOSED) {
    throw new ConversationPersistenceError({
      code: ConversationPersistenceErrorCodes.CONVERSATION_CLOSED,
      message: `Conversation '${existingConversation.id}' is closed and cannot be claimed.`,
    });
  }

  return existingConversation;
}
