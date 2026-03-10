import {
  automationConversations,
  AutomationConversationStatuses,
  AutomationConversationOwnerKinds,
  type AutomationConversationCreatedByKind,
  type AutomationConversationIntegrationFamilyId,
  type InsertAutomationConversation,
  type AutomationConversationOwnerKind,
} from "@mistle/db/control-plane";
import { typeid } from "typeid-js";

import {
  AutomationConversationPersistenceError,
  AutomationConversationPersistenceErrorCodes,
} from "./errors.js";
import type { AutomationConversationPersistenceDependencies } from "./types.js";

export type ClaimAutomationConversationInput = {
  organizationId: string;
  ownerKind: AutomationConversationOwnerKind;
  ownerId: string;
  createdByKind: AutomationConversationCreatedByKind;
  createdById: string;
  conversationKey?: string;
  sandboxProfileId: string;
  integrationFamilyId: AutomationConversationIntegrationFamilyId;
  title?: string | null;
  preview?: string | null;
};

export async function claimAutomationConversation(
  deps: AutomationConversationPersistenceDependencies,
  input: ClaimAutomationConversationInput,
) {
  if (input.title !== undefined && input.title !== null) {
    throw new AutomationConversationPersistenceError({
      code: AutomationConversationPersistenceErrorCodes.CONVERSATION_TITLE_MUST_BE_NULL,
      message:
        "AutomationConversation title must be null at claim time. Titles are user-editable after creation.",
    });
  }

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
    title: null,
    preview: input.preview == null ? null : input.preview.slice(0, 160),
    status: AutomationConversationStatuses.PENDING,
  };

  const insertedRows = await deps.db
    .insert(automationConversations)
    .values(insertValues)
    .onConflictDoNothing({
      target: [
        automationConversations.organizationId,
        automationConversations.ownerKind,
        automationConversations.ownerId,
        automationConversations.conversationKey,
      ],
    })
    .returning();
  const insertedAutomationConversation = insertedRows[0];
  if (insertedAutomationConversation !== undefined) {
    return insertedAutomationConversation;
  }

  const existingAutomationConversation = await deps.db.query.automationConversations.findFirst({
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
