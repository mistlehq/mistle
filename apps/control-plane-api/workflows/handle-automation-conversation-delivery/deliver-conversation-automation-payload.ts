import { AutomationConversationDeliveryTaskStatuses } from "@mistle/db/control-plane";

import {
  activateAutomationConversationRoute,
  createAutomationConversationRoute,
  updateAutomationConversationExecution,
} from "./conversation-route.js";
import { markAutomationConversationDeliveryTaskDelivering } from "./delivery-tasks.js";
import {
  AutomationConversationPersistenceError,
  AutomationConversationPersistenceErrorCodes,
} from "./error.js";
import { AutomationConversationRouteBindingActions } from "./types.js";
import type {
  AutomationConversationRouteBindingAction,
  ConversationDeliveryExecutionInput,
  ExecutedConversationProviderDelivery,
  ExecuteConversationProviderDeliveryInput,
  HandleAutomationConversationDeliveryDependencies,
} from "./types.js";

function resolveAutomationConversationRouteBindingAction(input: {
  routeId: string | null;
  routeSandboxInstanceId: string | null;
  providerConversationId: string | null;
  ensuredSandboxInstanceId: string;
}): AutomationConversationRouteBindingAction {
  if (input.routeId === null) {
    return AutomationConversationRouteBindingActions.CREATE_ROUTE;
  }
  if (input.routeSandboxInstanceId !== input.ensuredSandboxInstanceId) {
    return AutomationConversationRouteBindingActions.FAIL_SANDBOX_MISMATCH;
  }
  if (input.providerConversationId === null) {
    return AutomationConversationRouteBindingActions.ACTIVATE_PENDING_ROUTE;
  }

  return AutomationConversationRouteBindingActions.REUSE_ACTIVE_ROUTE;
}

export async function deliverConversationAutomationPayload(
  ctx: Pick<HandleAutomationConversationDeliveryDependencies, "db"> & {
    executeConversationProviderDelivery: (
      input: ExecuteConversationProviderDeliveryInput,
    ) => Promise<ExecutedConversationProviderDelivery>;
  },
  input: ConversationDeliveryExecutionInput,
): Promise<void> {
  const task = await ctx.db.query.automationConversationDeliveryTasks.findFirst({
    where: (table, { eq }) => eq(table.id, input.taskId),
  });
  if (task === undefined) {
    throw new AutomationConversationPersistenceError({
      code: AutomationConversationPersistenceErrorCodes.CONVERSATION_DELIVERY_TASK_NOT_FOUND,
      message: `AutomationConversation delivery task '${input.taskId}' was not found.`,
    });
  }

  if (task.processorGeneration !== input.generation) {
    throw new AutomationConversationPersistenceError({
      code: AutomationConversationPersistenceErrorCodes.CONVERSATION_DELIVERY_TASK_NOT_ACTIVE,
      message: `AutomationConversation delivery task '${input.taskId}' is not active for generation '${input.generation}'.`,
    });
  }

  if (task.status === AutomationConversationDeliveryTaskStatuses.DELIVERING) {
    throw new Error(
      `AutomationConversation delivery task '${input.taskId}' resumed after delivery started.`,
    );
  }

  if (task.status !== AutomationConversationDeliveryTaskStatuses.CLAIMED) {
    throw new AutomationConversationPersistenceError({
      code: AutomationConversationPersistenceErrorCodes.CONVERSATION_DELIVERY_TASK_NOT_CLAIMED,
      message: `AutomationConversation delivery task '${input.taskId}' is not claimed by generation '${input.generation}'.`,
    });
  }

  await markAutomationConversationDeliveryTaskDelivering(
    {
      db: ctx.db,
    },
    {
      taskId: input.taskId,
      generation: input.generation,
    },
  );

  const persistedRouteId = input.resolvedAutomationConversationRoute.routeId;
  let route;
  if (persistedRouteId === null) {
    route = await createAutomationConversationRoute(
      {
        db: ctx.db,
      },
      {
        conversationId: input.preparedAutomationRun.conversationId,
        sandboxInstanceId: input.ensuredAutomationSandbox.sandboxInstanceId,
      },
    );
  } else {
    route = await ctx.db.query.automationConversationRoutes.findFirst({
      where: (table, { eq }) => eq(table.id, persistedRouteId),
    });
  }

  if (route === undefined) {
    throw new AutomationConversationPersistenceError({
      code: AutomationConversationPersistenceErrorCodes.CONVERSATION_ROUTE_NOT_FOUND,
      message: `AutomationConversation route for conversation '${input.preparedAutomationRun.conversationId}' was not found.`,
    });
  }

  const routeBindingAction = resolveAutomationConversationRouteBindingAction({
    routeId: route.id,
    routeSandboxInstanceId: route.sandboxInstanceId,
    providerConversationId: route.providerConversationId,
    ensuredSandboxInstanceId: input.ensuredAutomationSandbox.sandboxInstanceId,
  });

  if (routeBindingAction === AutomationConversationRouteBindingActions.FAIL_SANDBOX_MISMATCH) {
    throw new Error(
      `AutomationConversation '${input.preparedAutomationRun.conversationId}' is bound to sandbox '${route.sandboxInstanceId}', but delivery acquired sandbox '${input.ensuredAutomationSandbox.sandboxInstanceId}'.`,
    );
  }

  const deliveryResult = await ctx.executeConversationProviderDelivery({
    requestId: input.taskId,
    conversationId: input.preparedAutomationRun.conversationId,
    integrationFamilyId: input.resolvedAutomationConversationRoute.integrationFamilyId,
    connectionUrl: input.acquiredAutomationConnection.url,
    inputText: input.preparedAutomationRun.renderedInput,
    providerConversationId: route.providerConversationId,
    providerExecutionId: route.providerExecutionId,
  });

  if (
    route.providerConversationId !== null &&
    deliveryResult.providerConversationId !== route.providerConversationId
  ) {
    throw new Error(
      `AutomationConversation '${input.preparedAutomationRun.conversationId}' changed provider conversation from '${route.providerConversationId}' to '${deliveryResult.providerConversationId}' during delivery.`,
    );
  }

  if (routeBindingAction !== AutomationConversationRouteBindingActions.REUSE_ACTIVE_ROUTE) {
    route = await activateAutomationConversationRoute(
      {
        db: ctx.db,
      },
      {
        conversationId: input.preparedAutomationRun.conversationId,
        routeId: route.id,
        sandboxInstanceId: input.ensuredAutomationSandbox.sandboxInstanceId,
        providerConversationId: deliveryResult.providerConversationId,
        providerState: deliveryResult.providerState,
      },
    );
  }

  await updateAutomationConversationExecution(
    {
      db: ctx.db,
    },
    {
      routeId: route.id,
      providerExecutionId: deliveryResult.providerExecutionId,
      providerState: deliveryResult.providerState,
    },
  );
}
