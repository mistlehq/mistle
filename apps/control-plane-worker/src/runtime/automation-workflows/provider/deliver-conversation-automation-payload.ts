import {
  AutomationConversationDeliveryTaskStatuses,
  type ControlPlaneDatabase,
} from "@mistle/db/control-plane";
import {
  AutomationConversationPersistenceError,
  AutomationConversationPersistenceErrorCodes,
  AutomationConversationRouteBindingActions,
  resolveAutomationConversationRouteBindingAction,
} from "@mistle/workflows/control-plane/runtime";

import type { DeliverAutomationConversationPayloadServiceInput } from "../../services/types.js";
import {
  activateAutomationConversationRoute,
  createAutomationConversationRoute,
  markAutomationConversationDeliveryTaskDelivering,
  updateAutomationConversationExecution,
} from "../persistence/index.js";
import {
  AutomationConversationExecutionActions,
  AutomationConversationSteerRecoveryActions,
  isRecoverableLateSteerError,
  resolveAutomationConversationExecutionAction,
  resolveAutomationConversationSteerRecoveryAction,
} from "../planning/automation-conversation-delivery.js";
import { getConversationProviderAdapter } from "./provider-adapter.js";

export type DeliverConversationAutomationPayloadDependencies = {
  db: ControlPlaneDatabase;
};

class ConversationDeliveryExecutionError extends Error {}

async function steerConversationExecution(input: {
  adapter: ReturnType<typeof getConversationProviderAdapter>;
  connection: Awaited<ReturnType<ReturnType<typeof getConversationProviderAdapter>["connect"]>>;
  route: {
    id: string;
    conversationId: string;
    providerConversationId: string | null;
    providerExecutionId: string | null;
  };
  inputText: string;
}) {
  if (input.route.providerConversationId === null) {
    throw new ConversationDeliveryExecutionError(
      `AutomationConversation '${input.route.conversationId}' is missing provider conversation id while attempting to steer execution.`,
    );
  }
  if (input.route.providerExecutionId === null) {
    throw new ConversationDeliveryExecutionError(
      `AutomationConversation '${input.route.conversationId}' is missing provider execution id while attempting to steer execution.`,
    );
  }
  if (input.adapter.steerExecution === undefined) {
    throw new ConversationDeliveryExecutionError(
      `AutomationConversation integration family does not support steering execution for conversation '${input.route.conversationId}'.`,
    );
  }

  return input.adapter.steerExecution({
    connection: input.connection,
    providerConversationId: input.route.providerConversationId,
    providerExecutionId: input.route.providerExecutionId,
    inputText: input.inputText,
  });
}

async function recoverLateSteerExecution(input: {
  adapter: ReturnType<typeof getConversationProviderAdapter>;
  connection: Awaited<ReturnType<ReturnType<typeof getConversationProviderAdapter>["connect"]>>;
  route: {
    conversationId: string;
    providerConversationId: string;
  };
  inputText: string;
}) {
  const inspectResult = await input.adapter.inspectAutomationConversation({
    connection: input.connection,
    providerConversationId: input.route.providerConversationId,
  });
  const recoveryAction = resolveAutomationConversationSteerRecoveryAction({
    inspectAutomationConversation: inspectResult,
  });

  switch (recoveryAction) {
    case AutomationConversationSteerRecoveryActions.START:
      return input.adapter.startExecution({
        connection: input.connection,
        providerConversationId: input.route.providerConversationId,
        inputText: input.inputText,
      });
    case AutomationConversationSteerRecoveryActions.FAIL_MISSING_CONVERSATION:
      throw new ConversationDeliveryExecutionError(
        `AutomationConversation '${input.route.conversationId}' references missing provider conversation '${input.route.providerConversationId}' after steer reported no active turn.`,
      );
    case AutomationConversationSteerRecoveryActions.FAIL_PROVIDER_ERROR:
      throw new ConversationDeliveryExecutionError(
        `AutomationConversation '${input.route.conversationId}' provider conversation '${input.route.providerConversationId}' is in error state after steer reported no active turn.`,
      );
    case AutomationConversationSteerRecoveryActions.FAIL_STILL_ACTIVE:
      throw new ConversationDeliveryExecutionError(
        `AutomationConversation '${input.route.conversationId}' provider conversation '${input.route.providerConversationId}' is still active after steer reported no active turn.`,
      );
  }
}

export async function deliverConversationAutomationPayload(
  ctx: DeliverConversationAutomationPayloadDependencies,
  input: DeliverAutomationConversationPayloadServiceInput & {
    taskId: string;
    generation: number;
  },
) {
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

  const adapter = getConversationProviderAdapter(
    input.resolvedAutomationConversationRoute.integrationFamilyId,
  );
  const connection = await adapter.connect({
    connectionUrl: input.acquiredAutomationConnection.url,
    requestId: input.taskId,
  });

  try {
    const persistedRouteId = input.resolvedAutomationConversationRoute.routeId;
    let route =
      persistedRouteId === null
        ? await createAutomationConversationRoute(
            {
              db: ctx.db,
            },
            {
              conversationId: input.preparedAutomationRun.conversationId,
              sandboxInstanceId: input.ensuredAutomationSandbox.sandboxInstanceId,
            },
          )
        : await ctx.db.query.automationConversationRoutes.findFirst({
            where: (table, { eq }) => eq(table.id, persistedRouteId),
          });

    if (route === undefined) {
      throw new AutomationConversationPersistenceError({
        code: AutomationConversationPersistenceErrorCodes.CONVERSATION_ROUTE_NOT_FOUND,
        message: `AutomationConversation route for conversation '${input.preparedAutomationRun.conversationId}' was not found.`,
      });
    }

    const routeBindingAction = resolveAutomationConversationRouteBindingAction({
      routeId: input.resolvedAutomationConversationRoute.routeId,
      routeSandboxInstanceId: route.sandboxInstanceId,
      providerConversationId: route.providerConversationId,
      ensuredSandboxInstanceId: input.ensuredAutomationSandbox.sandboxInstanceId,
    });

    switch (routeBindingAction) {
      case AutomationConversationRouteBindingActions.CREATE_ROUTE:
      case AutomationConversationRouteBindingActions.ACTIVATE_PENDING_ROUTE: {
        const createdAutomationConversation = await adapter.createAutomationConversation({
          connection,
        });

        route = await activateAutomationConversationRoute(
          {
            db: ctx.db,
          },
          {
            conversationId: input.preparedAutomationRun.conversationId,
            routeId: route.id,
            sandboxInstanceId: input.ensuredAutomationSandbox.sandboxInstanceId,
            providerConversationId: createdAutomationConversation.providerConversationId,
            providerState: createdAutomationConversation.providerState,
          },
        );
        break;
      }
      case AutomationConversationRouteBindingActions.REUSE_ACTIVE_ROUTE:
        break;
      case AutomationConversationRouteBindingActions.FAIL_SANDBOX_MISMATCH:
        throw new ConversationDeliveryExecutionError(
          `AutomationConversation '${input.preparedAutomationRun.conversationId}' is bound to sandbox '${route.sandboxInstanceId}', but delivery acquired sandbox '${input.ensuredAutomationSandbox.sandboxInstanceId}'.`,
        );
    }

    if (route.providerConversationId === null) {
      throw new ConversationDeliveryExecutionError(
        `AutomationConversation '${input.preparedAutomationRun.conversationId}' is missing provider conversation id after route activation.`,
      );
    }

    const inspectResult = await adapter.inspectAutomationConversation({
      connection,
      providerConversationId: route.providerConversationId,
    });
    const executionAction = resolveAutomationConversationExecutionAction({
      inspectAutomationConversation: inspectResult,
      providerExecutionId: route.providerExecutionId,
      adapter,
    });

    let executionUpdate;
    switch (executionAction) {
      case AutomationConversationExecutionActions.START:
        executionUpdate = await adapter.startExecution({
          connection,
          providerConversationId: route.providerConversationId,
          inputText: input.preparedAutomationRun.renderedInput,
        });
        break;
      case AutomationConversationExecutionActions.STEER:
        try {
          executionUpdate = await steerConversationExecution({
            adapter,
            connection,
            route,
            inputText: input.preparedAutomationRun.renderedInput,
          });
        } catch (error) {
          if (!isRecoverableLateSteerError({ error })) {
            throw error;
          }

          executionUpdate = await recoverLateSteerExecution({
            adapter,
            connection,
            route: {
              conversationId: route.conversationId,
              providerConversationId: route.providerConversationId,
            },
            inputText: input.preparedAutomationRun.renderedInput,
          });
        }
        break;
      case AutomationConversationExecutionActions.FAIL_MISSING_CONVERSATION:
        throw new ConversationDeliveryExecutionError(
          `AutomationConversation '${input.preparedAutomationRun.conversationId}' references missing provider conversation '${route.providerConversationId}'.`,
        );
      case AutomationConversationExecutionActions.FAIL_PROVIDER_ERROR:
        throw new ConversationDeliveryExecutionError(
          `AutomationConversation '${input.preparedAutomationRun.conversationId}' provider conversation '${route.providerConversationId}' is in error state.`,
        );
      case AutomationConversationExecutionActions.FAIL_MISSING_EXECUTION:
        throw new ConversationDeliveryExecutionError(
          `AutomationConversation '${input.preparedAutomationRun.conversationId}' is missing provider execution id while provider conversation '${route.providerConversationId}' is active.`,
        );
      case AutomationConversationExecutionActions.FAIL_STEER_NOT_SUPPORTED:
        throw new ConversationDeliveryExecutionError(
          `AutomationConversation integration family '${input.resolvedAutomationConversationRoute.integrationFamilyId}' does not support steering active execution for conversation '${input.preparedAutomationRun.conversationId}'.`,
        );
    }

    await updateAutomationConversationExecution(
      {
        db: ctx.db,
      },
      {
        routeId: route.id,
        providerExecutionId: executionUpdate.providerExecutionId,
        providerState: executionUpdate.providerState,
      },
    );
  } finally {
    await connection.close();
  }
}
