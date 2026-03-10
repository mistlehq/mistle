import {
  AutomationConversationDeliveryTaskStatuses,
  type ControlPlaneDatabase,
} from "@mistle/db/control-plane";
import {
  ActiveAutomationConversationDeliveryTaskStatuses,
  type HandleAutomationConversationDeliveryWorkflowInput,
  type ResolvedAutomationConversationDeliveryRoute,
} from "@mistle/workflows/control-plane";

import type {
  DeliverAutomationConversationPayloadServiceInput,
  EnsureAutomationConversationDeliverySandboxServiceInput,
} from "../../services/types.js";
import {
  activateAutomationConversationRoute,
  AutomationConversationDeliveryTaskActions,
  claimNextAutomationConversationDeliveryTask,
  AutomationConversationPersistenceError,
  AutomationConversationPersistenceErrorCodes,
  createAutomationConversationRoute,
  finalizeAutomationConversationDeliveryTask,
  findActiveAutomationConversationDeliveryTask,
  idleAutomationConversationDeliveryProcessorIfEmpty,
  markAutomationConversationDeliveryTaskDelivering,
  resolveAutomationConversationDeliveryTaskAction,
  updateAutomationConversationExecution,
} from "../persistence/index.js";
import {
  AutomationConversationRouteBindingActions,
  AutomationConversationDeliverySandboxActions,
  AutomationConversationExecutionActions,
  AutomationConversationSteerRecoveryActions,
  isRecoverableLateSteerError,
  resolveAutomationConversationDeliverySandboxAction,
  resolveAutomationConversationExecutionAction,
  resolveAutomationConversationRouteBindingAction,
  resolveAutomationConversationSteerRecoveryAction,
} from "../planning/automation-conversation-delivery.js";
import { getConversationProviderAdapter } from "../provider/provider-adapter.js";
import {
  acquireAutomationConnection,
  ensureAutomationSandbox,
  markAutomationRunCompleted,
  markAutomationRunIgnored,
  markAutomationRunFailed,
  prepareAutomationRun,
  resolveAutomationRunFailure,
  type AcquireAutomationConnectionDependencies,
  type EnsureAutomationSandboxDependencies,
} from "./automation-run-execution.js";

export type HandleAutomationConversationDeliveryDependencies = {
  db: ControlPlaneDatabase;
  startSandboxProfileInstance: EnsureAutomationSandboxDependencies["startSandboxProfileInstance"];
  getSandboxInstance: AcquireAutomationConnectionDependencies["getSandboxInstance"];
  mintSandboxConnectionToken: AcquireAutomationConnectionDependencies["mintSandboxConnectionToken"];
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

export type ClaimOrResumeAutomationConversationDeliveryTaskInput =
  HandleAutomationConversationDeliveryWorkflowInput;

export async function claimOrResumeAutomationConversationDeliveryTask(
  deps: Pick<HandleAutomationConversationDeliveryDependencies, "db">,
  input: ClaimOrResumeAutomationConversationDeliveryTaskInput,
) {
  const activeTask = await findActiveAutomationConversationDeliveryTask(
    {
      db: deps.db,
    },
    {
      conversationId: input.conversationId,
      generation: input.generation,
    },
  );
  if (activeTask !== undefined) {
    if (activeTask.status === AutomationConversationDeliveryTaskStatuses.CLAIMED) {
      return {
        taskId: activeTask.id,
        automationRunId: activeTask.automationRunId,
        status: ActiveAutomationConversationDeliveryTaskStatuses.CLAIMED,
      };
    }

    if (activeTask.status === AutomationConversationDeliveryTaskStatuses.DELIVERING) {
      return {
        taskId: activeTask.id,
        automationRunId: activeTask.automationRunId,
        status: ActiveAutomationConversationDeliveryTaskStatuses.DELIVERING,
      };
    }

    throw new AutomationConversationPersistenceError({
      code: AutomationConversationPersistenceErrorCodes.CONVERSATION_DELIVERY_TASK_NOT_ACTIVE,
      message: `AutomationConversation delivery task '${activeTask.id}' is in unexpected active status '${activeTask.status}'.`,
    });
  }

  const claimedTask = await claimNextAutomationConversationDeliveryTask(
    {
      db: deps.db,
    },
    {
      conversationId: input.conversationId,
      generation: input.generation,
    },
  );
  if (claimedTask === null) {
    return null;
  }

  return {
    taskId: claimedTask.id,
    automationRunId: claimedTask.automationRunId,
    status: ActiveAutomationConversationDeliveryTaskStatuses.CLAIMED,
  };
}

export async function idleAutomationConversationDeliveryProcessor(
  deps: Pick<HandleAutomationConversationDeliveryDependencies, "db">,
  input: HandleAutomationConversationDeliveryWorkflowInput,
) {
  return idleAutomationConversationDeliveryProcessorIfEmpty(
    {
      db: deps.db,
    },
    input,
  );
}

export async function resolveAutomationConversationDeliveryActiveTaskAction(
  deps: Pick<HandleAutomationConversationDeliveryDependencies, "db">,
  input: {
    taskId: string;
    generation: number;
  },
) {
  return resolveAutomationConversationDeliveryTaskAction(
    {
      db: deps.db,
    },
    input,
  );
}

export async function prepareConversationDeliveryAutomationRun(
  deps: Pick<HandleAutomationConversationDeliveryDependencies, "db">,
  input: { automationRunId: string },
) {
  return prepareAutomationRun(
    {
      db: deps.db,
    },
    {
      automationRunId: input.automationRunId,
    },
  );
}

export async function resolveAutomationConversationDeliveryRoute(
  deps: Pick<HandleAutomationConversationDeliveryDependencies, "db">,
  input: {
    conversationId: string;
  },
): Promise<ResolvedAutomationConversationDeliveryRoute> {
  const conversation = await deps.db.query.automationConversations.findFirst({
    where: (table, { eq }) => eq(table.id, input.conversationId),
  });
  if (conversation === undefined) {
    throw new AutomationConversationPersistenceError({
      code: AutomationConversationPersistenceErrorCodes.CONVERSATION_NOT_FOUND,
      message: `AutomationConversation '${input.conversationId}' was not found.`,
    });
  }

  const route = await deps.db.query.automationConversationRoutes.findFirst({
    where: (table, { eq }) => eq(table.conversationId, input.conversationId),
  });

  return {
    conversationId: conversation.id,
    integrationFamilyId: conversation.integrationFamilyId,
    routeId: route?.id ?? null,
    sandboxInstanceId: route?.sandboxInstanceId ?? null,
    providerConversationId: route?.providerConversationId ?? null,
    providerExecutionId: route?.providerExecutionId ?? null,
    providerState: route?.providerState ?? null,
  };
}

export async function ensureConversationDeliverySandbox(
  deps: Pick<
    HandleAutomationConversationDeliveryDependencies,
    "db" | "getSandboxInstance" | "startSandboxProfileInstance"
  >,
  input: EnsureAutomationConversationDeliverySandboxServiceInput,
) {
  if (input.resolvedAutomationConversationRoute.sandboxInstanceId !== null) {
    const existingSandbox = await deps.getSandboxInstance({
      organizationId: input.preparedAutomationRun.organizationId,
      instanceId: input.resolvedAutomationConversationRoute.sandboxInstanceId,
    });

    const sandboxAction = resolveAutomationConversationDeliverySandboxAction({
      sandboxInstanceId: input.resolvedAutomationConversationRoute.sandboxInstanceId,
      sandboxStatus: existingSandbox.status,
    });

    if (sandboxAction === AutomationConversationDeliverySandboxActions.REUSE_EXISTING) {
      return {
        sandboxInstanceId: existingSandbox.id,
        startupWorkflowRunId: null,
      };
    }
    if (sandboxAction === AutomationConversationDeliverySandboxActions.FAIL) {
      throw new ConversationDeliveryExecutionError(
        `AutomationConversation '${input.preparedAutomationRun.conversationId}' is bound to sandbox '${input.resolvedAutomationConversationRoute.sandboxInstanceId}', but that sandbox is '${existingSandbox.status}'.`,
      );
    }
  }

  return ensureAutomationSandbox(
    {
      db: deps.db,
      startSandboxProfileInstance: deps.startSandboxProfileInstance,
    },
    {
      preparedAutomationRun: input.preparedAutomationRun,
    },
  );
}

export async function acquireConversationDeliveryConnection(
  deps: Pick<
    HandleAutomationConversationDeliveryDependencies,
    "getSandboxInstance" | "mintSandboxConnectionToken"
  >,
  input: Parameters<typeof acquireAutomationConnection>[1],
) {
  return acquireAutomationConnection(
    {
      getSandboxInstance: deps.getSandboxInstance,
      mintSandboxConnectionToken: deps.mintSandboxConnectionToken,
    },
    input,
  );
}

export async function deliverConversationAutomationPayload(
  deps: Pick<HandleAutomationConversationDeliveryDependencies, "db">,
  input: DeliverAutomationConversationPayloadServiceInput & {
    taskId: string;
    generation: number;
  },
) {
  const task = await deps.db.query.automationConversationDeliveryTasks.findFirst({
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
      db: deps.db,
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
              db: deps.db,
            },
            {
              conversationId: input.preparedAutomationRun.conversationId,
              sandboxInstanceId: input.ensuredAutomationSandbox.sandboxInstanceId,
            },
          )
        : await deps.db.query.automationConversationRoutes.findFirst({
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
            db: deps.db,
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
        db: deps.db,
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

export async function completeConversationDeliveryAutomationRun(
  deps: Pick<HandleAutomationConversationDeliveryDependencies, "db">,
  input: {
    automationRunId: string;
  },
) {
  await markAutomationRunCompleted(
    {
      db: deps.db,
    },
    input,
  );
}

export async function ignoreAutomationConversationDeliveryAutomationRun(
  deps: Pick<HandleAutomationConversationDeliveryDependencies, "db">,
  input: {
    automationRunId: string;
  },
) {
  await markAutomationRunIgnored(
    {
      db: deps.db,
    },
    input,
  );
}

export async function failConversationDeliveryAutomationRun(
  deps: Pick<HandleAutomationConversationDeliveryDependencies, "db">,
  input: {
    automationRunId: string;
    failureCode: string;
    failureMessage: string;
  },
) {
  await markAutomationRunFailed(
    {
      db: deps.db,
    },
    input,
  );
}

export async function finalizeAutomationConversationDeliveryActiveTask(
  deps: Pick<HandleAutomationConversationDeliveryDependencies, "db">,
  input: {
    taskId: string;
    generation: number;
    status: "completed" | "failed" | "ignored";
    failureCode?: string | null;
    failureMessage?: string | null;
  },
) {
  await finalizeAutomationConversationDeliveryTask(
    {
      db: deps.db,
    },
    input,
  );
}

export { resolveAutomationRunFailure };
export { AutomationConversationDeliveryTaskActions };
