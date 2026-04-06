import {
  AutomationConversationRouteStatuses,
  AutomationConversationStatuses,
  type ControlPlaneDatabase,
} from "@mistle/db/control-plane";

type ResolvedSandboxInstanceAutomationConversation = {
  conversationId: string;
  routeId: string;
  providerConversationId: string | null;
  title: string | null;
};

export async function resolveInstanceAutomationConversations(
  db: ControlPlaneDatabase,
  input: {
    organizationId: string;
    instanceIds: readonly string[];
  },
): Promise<Map<string, ResolvedSandboxInstanceAutomationConversation>> {
  if (input.instanceIds.length === 0) {
    return new Map();
  }

  const routes = await db.query.automationConversationRoutes.findMany({
    columns: {
      id: true,
      conversationId: true,
      sandboxInstanceId: true,
      providerConversationId: true,
      updatedAt: true,
    },
    where: (table, { and, eq, inArray }) =>
      and(
        eq(table.status, AutomationConversationRouteStatuses.ACTIVE),
        inArray(table.sandboxInstanceId, input.instanceIds),
      ),
  });
  if (routes.length === 0) {
    return new Map();
  }

  const conversations = await db.query.automationConversations.findMany({
    columns: {
      id: true,
      title: true,
      status: true,
    },
    where: (table, { and, eq, inArray, or }) =>
      and(
        eq(table.organizationId, input.organizationId),
        inArray(
          table.id,
          routes.map((route) => route.conversationId),
        ),
        or(
          eq(table.status, AutomationConversationStatuses.PENDING),
          eq(table.status, AutomationConversationStatuses.ACTIVE),
        ),
      ),
  });

  const routeById = new Map(routes.map((route) => [route.id, route]));
  const conversationById = new Map(
    conversations.map((conversation) => [conversation.id, conversation]),
  );
  const resolvedByInstanceId = new Map<string, ResolvedSandboxInstanceAutomationConversation>();

  for (const route of routes) {
    const conversation = conversationById.get(route.conversationId);
    if (conversation === undefined) {
      continue;
    }

    const resolved = {
      conversationId: conversation.id,
      routeId: route.id,
      providerConversationId: route.providerConversationId,
      title: conversation.title,
    } satisfies ResolvedSandboxInstanceAutomationConversation;
    const existing = resolvedByInstanceId.get(route.sandboxInstanceId);
    if (existing === undefined) {
      resolvedByInstanceId.set(route.sandboxInstanceId, resolved);
      continue;
    }

    const existingRoute = routeById.get(existing.routeId);
    if (existingRoute === undefined) {
      resolvedByInstanceId.set(route.sandboxInstanceId, resolved);
      continue;
    }

    const updatedAtComparison = route.updatedAt.localeCompare(existingRoute.updatedAt);
    if (
      updatedAtComparison > 0 ||
      (updatedAtComparison === 0 && route.id.localeCompare(existingRoute.id) > 0)
    ) {
      resolvedByInstanceId.set(route.sandboxInstanceId, resolved);
    }
  }

  return resolvedByInstanceId;
}
