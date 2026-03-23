import type { DataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import {
  AutomationConversationRouteStatuses,
  AutomationConversationStatuses,
  type ControlPlaneDatabase,
} from "@mistle/db/control-plane";

import { SandboxInstancesNotFoundCodes, SandboxInstancesNotFoundError } from "./errors.js";
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
      updatedAt: true,
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

  const matchingRoutes: Array<
    SandboxInstanceAutomationConversation & {
      updatedAt: string;
    }
  > = [];

  for (const route of routes) {
    const conversation = await db.query.automationConversations.findFirst({
      columns: {
        id: true,
      },
      where: (table, { and, eq, or }) =>
        and(
          eq(table.id, route.conversationId),
          eq(table.organizationId, input.organizationId),
          or(
            eq(table.status, AutomationConversationStatuses.PENDING),
            eq(table.status, AutomationConversationStatuses.ACTIVE),
          ),
        ),
    });
    if (conversation === undefined) {
      continue;
    }

    matchingRoutes.push({
      updatedAt: route.updatedAt,
      conversationId: conversation.id,
      routeId: route.id,
      providerConversationId: route.providerConversationId,
    });
  }

  if (matchingRoutes.length === 0) {
    return null;
  }

  if (matchingRoutes.length > 1) {
    matchingRoutes.sort((left, right) => {
      const updatedAtComparison = right.updatedAt.localeCompare(left.updatedAt);
      if (updatedAtComparison !== 0) {
        return updatedAtComparison;
      }

      return (right.routeId ?? "").localeCompare(left.routeId ?? "");
    });
  }

  const mostRecentRoute = matchingRoutes[0];
  if (mostRecentRoute === undefined) {
    return null;
  }

  return {
    conversationId: mostRecentRoute.conversationId,
    routeId: mostRecentRoute.routeId,
    providerConversationId: mostRecentRoute.providerConversationId,
  };
}

export async function getInstance(
  {
    db,
    dataPlaneClient,
  }: {
    db: ControlPlaneDatabase;
    dataPlaneClient: DataPlaneSandboxInstancesClient;
  },
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
