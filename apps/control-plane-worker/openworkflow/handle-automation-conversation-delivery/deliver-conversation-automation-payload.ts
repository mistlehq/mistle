import {
  AutomationConversationDeliveryTaskStatuses,
  type ControlPlaneDatabase,
} from "@mistle/db/control-plane";

import { executeConversationProviderDelivery } from "../../src/runtime/automation-workflows/provider/execute-conversation-provider-delivery.js";
import type {
  AcquiredAutomationConnection,
  EnsuredAutomationSandbox,
  PreparedAutomationRun,
  ResolvedAutomationConversationDeliveryRoute,
} from "../../src/runtime/workflow-types.js";
import {
  AutomationConversationRouteBindingActions,
  resolveAutomationConversationRouteBindingAction,
} from "../../src/runtime/workflows/conversation-delivery-planning.js";
import { activateAutomationConversationRoute } from "../../src/runtime/workflows/persistence/activate-conversation-route.js";
import { createAutomationConversationRoute } from "../../src/runtime/workflows/persistence/create-conversation-route.js";
import {
  AutomationConversationPersistenceError,
  AutomationConversationPersistenceErrorCodes,
} from "../../src/runtime/workflows/persistence/errors.js";
import { markAutomationConversationDeliveryTaskDelivering } from "../../src/runtime/workflows/persistence/mark-conversation-delivery-task-delivering.js";
import { updateAutomationConversationExecution } from "../../src/runtime/workflows/persistence/update-conversation-execution.js";

export async function deliverConversationAutomationPayload(
  ctx: {
    db: ControlPlaneDatabase;
  },
  input: {
    taskId: string;
    generation: number;
    preparedAutomationRun: PreparedAutomationRun;
    resolvedAutomationConversationRoute: ResolvedAutomationConversationDeliveryRoute;
    ensuredAutomationSandbox: EnsuredAutomationSandbox;
    acquiredAutomationConnection: AcquiredAutomationConnection;
  },
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

  const deliveryResult = await executeConversationProviderDelivery({
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
