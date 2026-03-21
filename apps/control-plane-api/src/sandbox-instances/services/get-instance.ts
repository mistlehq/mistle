import type { DataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import {
  AutomationConversationRouteStatuses,
  AutomationConversationStatuses,
  type ControlPlaneDatabase,
} from "@mistle/db/control-plane";

import {
  SandboxInstancesConflictCodes,
  SandboxInstancesConflictError,
  SandboxInstancesNotFoundCodes,
  SandboxInstancesNotFoundError,
} from "./errors.js";
import type { SandboxInstanceAutomationConversation, SandboxInstanceStatus } from "./types.js";

async function resolveAutomationConversation(
  db: ControlPlaneDatabase,
  input: {
    organizationId: string;
    instanceId: string;
  },
): Promise<SandboxInstanceAutomationConversation | null> {
  const routes = await db.query.automationConversationRoutes.findMany({
    columns: {
      id: true,
      conversationId: true,
      providerConversationId: true,
    },
    where: (table, { and, eq }) =>
      and(
        eq(table.sandboxInstanceId, input.instanceId),
        eq(table.status, AutomationConversationRouteStatuses.ACTIVE),
      ),
  });

  const matchingRoutes: SandboxInstanceAutomationConversation[] = [];

  for (const route of routes) {
    const conversation = await db.query.automationConversations.findFirst({
      columns: {
        id: true,
      },
      where: (table, { and, eq }) =>
        and(
          eq(table.id, route.conversationId),
          eq(table.organizationId, input.organizationId),
          eq(table.status, AutomationConversationStatuses.ACTIVE),
        ),
    });
    if (conversation === undefined) {
      continue;
    }

    matchingRoutes.push({
      conversationId: conversation.id,
      routeId: route.id,
      providerConversationId: route.providerConversationId,
    });
  }

  if (matchingRoutes.length === 0) {
    return null;
  }

  if (matchingRoutes.length > 1) {
    throw new SandboxInstancesConflictError(
      SandboxInstancesConflictCodes.MULTIPLE_ACTIVE_AUTOMATION_CONVERSATIONS,
      `Expected at most one active automation conversation for sandbox instance '${input.instanceId}', found ${String(matchingRoutes.length)}.`,
    );
  }

  return matchingRoutes[0] ?? null;
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
