import type { DataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import {
  TriggerConversationRouteStatuses,
  TriggerConversationStatuses,
  type ControlPlaneDatabase,
} from "@mistle/db/control-plane";
import type { CompiledRuntimePlan } from "@mistle/integrations-core";

import {
  ProviderResourceAssociationDeliveryError,
  ProviderResourceAssociationDeliveryFailureCodes,
} from "./errors.js";

export type ResolvedProviderResourceAssociationDeliveryRoute = {
  organizationId: string;
  providerResourceAssociationId: string;
  sandboxInstanceId: string;
  conversationId: string;
  routeId: string;
  runtimeId: string;
  workingDirectory: string;
  providerConversationId: string;
  providerExecutionId: string | null;
};

export async function resolveProviderResourceAssociationDeliveryRoute(
  ctx: {
    dataPlaneClient: Pick<DataPlaneSandboxInstancesClient, "getSandboxInstance">;
    db: ControlPlaneDatabase;
  },
  input: {
    providerResourceAssociationId: string;
  },
): Promise<ResolvedProviderResourceAssociationDeliveryRoute> {
  const association = await ctx.db.query.providerResourceAssociations.findFirst({
    columns: {
      id: true,
      integrationConnectionId: true,
      sandboxInstanceId: true,
    },
    where: (table, { eq }) => eq(table.id, input.providerResourceAssociationId),
  });
  if (association === undefined) {
    throw new ProviderResourceAssociationDeliveryError({
      code: ProviderResourceAssociationDeliveryFailureCodes.ASSOCIATION_NOT_FOUND,
      message: `Provider resource association '${input.providerResourceAssociationId}' was not found.`,
    });
  }

  const integrationConnection = await ctx.db.query.integrationConnections.findFirst({
    columns: {
      organizationId: true,
    },
    where: (table, { eq }) => eq(table.id, association.integrationConnectionId),
  });
  if (integrationConnection === undefined) {
    throw new ProviderResourceAssociationDeliveryError({
      code: ProviderResourceAssociationDeliveryFailureCodes.ASSOCIATION_NOT_FOUND,
      message: `Provider resource association '${association.id}' references missing integration connection '${association.integrationConnectionId}'.`,
    });
  }

  const sandboxInstance = await ctx.dataPlaneClient.getSandboxInstance({
    organizationId: integrationConnection.organizationId,
    instanceId: association.sandboxInstanceId,
  });
  if (sandboxInstance === null) {
    throw new ProviderResourceAssociationDeliveryError({
      code: ProviderResourceAssociationDeliveryFailureCodes.SANDBOX_NOT_FOUND,
      message: `Provider resource association '${association.id}' references missing sandbox instance '${association.sandboxInstanceId}'.`,
    });
  }
  if (sandboxInstance.runtimePlan === null) {
    throw new ProviderResourceAssociationDeliveryError({
      code: ProviderResourceAssociationDeliveryFailureCodes.RUNTIME_PLAN_NOT_FOUND,
      message: `Sandbox instance '${association.sandboxInstanceId}' does not have a persisted runtime plan.`,
    });
  }

  const route = await resolveOriginalRuntimeConversationRoute(ctx.db, {
    organizationId: integrationConnection.organizationId,
    sandboxInstanceId: association.sandboxInstanceId,
  });
  const runtimeContext = resolveAssociationRuntimeContext(sandboxInstance.runtimePlan, {
    runtimeId: route.runtimeId,
  });

  return {
    organizationId: integrationConnection.organizationId,
    providerResourceAssociationId: association.id,
    sandboxInstanceId: association.sandboxInstanceId,
    conversationId: route.conversationId,
    routeId: route.routeId,
    runtimeId: runtimeContext.runtimeId,
    workingDirectory: runtimeContext.workingDirectory,
    providerConversationId: route.providerConversationId,
    providerExecutionId: route.providerExecutionId,
  };
}

async function resolveOriginalRuntimeConversationRoute(
  db: ControlPlaneDatabase,
  input: {
    organizationId: string;
    sandboxInstanceId: string;
  },
): Promise<{
  conversationId: string;
  routeId: string;
  runtimeId: string;
  providerConversationId: string;
  providerExecutionId: string | null;
}> {
  const routes = await db.query.triggerConversationRoutes.findMany({
    columns: {
      id: true,
      conversationId: true,
      providerConversationId: true,
      providerExecutionId: true,
      createdAt: true,
    },
    where: (table, { and, eq }) =>
      and(
        eq(table.sandboxInstanceId, input.sandboxInstanceId),
        eq(table.status, TriggerConversationRouteStatuses.ACTIVE),
      ),
    orderBy: (table, { asc }) => [asc(table.createdAt), asc(table.id)],
  });

  for (const route of routes) {
    const conversation = await db.query.triggerConversations.findFirst({
      columns: {
        id: true,
        createdAt: true,
        runtimeId: true,
      },
      where: (table, { and, eq, or }) =>
        and(
          eq(table.id, route.conversationId),
          eq(table.organizationId, input.organizationId),
          or(
            eq(table.status, TriggerConversationStatuses.PENDING),
            eq(table.status, TriggerConversationStatuses.ACTIVE),
          ),
        ),
    });
    if (conversation === undefined) {
      continue;
    }

    if (route.providerConversationId === null) {
      throw new ProviderResourceAssociationDeliveryError({
        code: ProviderResourceAssociationDeliveryFailureCodes.ROUTING_CONVERSATION_UNBOUND,
        message: `Sandbox instance '${input.sandboxInstanceId}' original runtime conversation route '${route.id}' has no provider conversation id.`,
      });
    }

    return {
      conversationId: conversation.id,
      routeId: route.id,
      runtimeId: conversation.runtimeId,
      providerConversationId: route.providerConversationId,
      providerExecutionId: route.providerExecutionId,
    };
  }

  throw new ProviderResourceAssociationDeliveryError({
    code: ProviderResourceAssociationDeliveryFailureCodes.ROUTING_CONVERSATION_NOT_FOUND,
    message: `Sandbox instance '${input.sandboxInstanceId}' has no active original runtime conversation route.`,
  });
}

function resolveAssociationRuntimeContext(
  runtimePlan: CompiledRuntimePlan,
  input: {
    runtimeId: string;
  },
): {
  runtimeId: string;
  workingDirectory: string;
} {
  const agentRuntime = runtimePlan.agentRuntimes.find(
    (candidate) => candidate.runtimeId === input.runtimeId,
  );
  if (agentRuntime === undefined) {
    throw new ProviderResourceAssociationDeliveryError({
      code: ProviderResourceAssociationDeliveryFailureCodes.RUNTIME_PLAN_AGENT_RUNTIME_NOT_FOUND,
      message: `Associated sandbox runtime plan does not define agent runtime '${input.runtimeId}'.`,
    });
  }

  const workingDirectory =
    agentRuntime.ptyLaunch.newLaunch.cwd ?? agentRuntime.ptyLaunch.resumeLaunch.cwd;
  if (workingDirectory === undefined) {
    throw new ProviderResourceAssociationDeliveryError({
      code: ProviderResourceAssociationDeliveryFailureCodes.RUNTIME_PLAN_WORKING_DIRECTORY_NOT_FOUND,
      message: `Associated sandbox runtime '${agentRuntime.runtimeId}' does not define a working directory.`,
    });
  }

  return {
    runtimeId: agentRuntime.runtimeId,
    workingDirectory,
  };
}
