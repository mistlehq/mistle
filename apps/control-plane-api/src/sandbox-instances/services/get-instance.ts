import type { DataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import type { ControlPlaneDatabase } from "@mistle/db/control-plane";

import { SandboxInstancesNotFoundCodes, SandboxInstancesNotFoundError } from "./errors.js";
import type { SandboxInstanceAutomationConversation, SandboxInstanceStatus } from "./types.js";

async function resolveAutomationConversation(
  db: ControlPlaneDatabase,
  input: {
    organizationId: string;
    instanceId: string;
  },
): Promise<SandboxInstanceAutomationConversation | null> {
  const route = await db.query.automationConversationRoutes.findFirst({
    columns: {
      id: true,
      conversationId: true,
      providerConversationId: true,
    },
    where: (table, { eq }) => eq(table.sandboxInstanceId, input.instanceId),
  });
  if (route === undefined) {
    return null;
  }

  const conversation = await db.query.automationConversations.findFirst({
    columns: {
      id: true,
    },
    where: (table, { and, eq }) =>
      and(eq(table.id, route.conversationId), eq(table.organizationId, input.organizationId)),
  });
  if (conversation === undefined) {
    return null;
  }

  return {
    conversationId: conversation.id,
    routeId: route.id,
    providerConversationId: route.providerConversationId,
  };
}

export async function getInstance(
  db: ControlPlaneDatabase,
  dataPlaneClient: DataPlaneSandboxInstancesClient,
  input: { organizationId: string; instanceId: string },
): Promise<SandboxInstanceStatus> {
  const sandboxInstance = await dataPlaneClient.getSandboxInstance({
    organizationId: input.organizationId,
    instanceId: input.instanceId,
  });

  if (sandboxInstance === null) {
    throw new SandboxInstancesNotFoundError(
      SandboxInstancesNotFoundCodes.INSTANCE_NOT_FOUND,
      `Sandbox instance '${input.instanceId}' was not found.`,
    );
  }

  const automationConversation = await resolveAutomationConversation(db, input);

  return {
    id: sandboxInstance.id,
    status: sandboxInstance.status,
    failureCode: sandboxInstance.failureCode,
    failureMessage: sandboxInstance.failureMessage,
    automationConversation,
  };
}
