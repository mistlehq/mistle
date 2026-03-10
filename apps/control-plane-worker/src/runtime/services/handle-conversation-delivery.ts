import {
  ConversationDeliveryTaskStatuses,
  type ControlPlaneDatabase,
} from "@mistle/db/control-plane";
import {
  ActiveConversationDeliveryTaskStatuses,
  type HandleConversationDeliveryWorkflowInput,
  type ResolvedConversationDeliveryRoute,
} from "@mistle/workflows/control-plane";

import {
  activateConversationRoute,
  ConversationDeliveryTaskActions,
  claimNextConversationDeliveryTask,
  ConversationPersistenceError,
  ConversationPersistenceErrorCodes,
  createConversationRoute,
  finalizeConversationDeliveryTask,
  findActiveConversationDeliveryTask,
  getConversationProviderAdapter,
  idleConversationDeliveryProcessorIfEmpty,
  markConversationDeliveryTaskDelivering,
  resolveConversationDeliveryTaskAction,
  updateConversationExecution,
} from "../conversations/index.js";
import {
  ConversationRouteBindingActions,
  ConversationDeliverySandboxActions,
  ConversationExecutionActions,
  ConversationSteerRecoveryActions,
  isRecoverableLateSteerError,
  resolveConversationDeliverySandboxAction,
  resolveConversationExecutionAction,
  resolveConversationRouteBindingAction,
  resolveConversationSteerRecoveryAction,
} from "./conversation-delivery-plans.js";
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
} from "./handle-automation-run.js";
import type {
  DeliverConversationAutomationPayloadServiceInput,
  EnsureConversationDeliverySandboxServiceInput,
} from "./types.js";

export type HandleConversationDeliveryDependencies = {
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
      `Conversation '${input.route.conversationId}' is missing provider conversation id while attempting to steer execution.`,
    );
  }
  if (input.route.providerExecutionId === null) {
    throw new ConversationDeliveryExecutionError(
      `Conversation '${input.route.conversationId}' is missing provider execution id while attempting to steer execution.`,
    );
  }
  if (input.adapter.steerExecution === undefined) {
    throw new ConversationDeliveryExecutionError(
      `Conversation integration family does not support steering execution for conversation '${input.route.conversationId}'.`,
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
  const inspectResult = await input.adapter.inspectConversation({
    connection: input.connection,
    providerConversationId: input.route.providerConversationId,
  });
  const recoveryAction = resolveConversationSteerRecoveryAction({
    inspectConversation: inspectResult,
  });

  switch (recoveryAction) {
    case ConversationSteerRecoveryActions.START:
      return input.adapter.startExecution({
        connection: input.connection,
        providerConversationId: input.route.providerConversationId,
        inputText: input.inputText,
      });
    case ConversationSteerRecoveryActions.FAIL_MISSING_CONVERSATION:
      throw new ConversationDeliveryExecutionError(
        `Conversation '${input.route.conversationId}' references missing provider conversation '${input.route.providerConversationId}' after steer reported no active turn.`,
      );
    case ConversationSteerRecoveryActions.FAIL_PROVIDER_ERROR:
      throw new ConversationDeliveryExecutionError(
        `Conversation '${input.route.conversationId}' provider conversation '${input.route.providerConversationId}' is in error state after steer reported no active turn.`,
      );
    case ConversationSteerRecoveryActions.FAIL_STILL_ACTIVE:
      throw new ConversationDeliveryExecutionError(
        `Conversation '${input.route.conversationId}' provider conversation '${input.route.providerConversationId}' is still active after steer reported no active turn.`,
      );
  }
}

export type ClaimOrResumeConversationDeliveryTaskInput = HandleConversationDeliveryWorkflowInput;

export async function claimOrResumeConversationDeliveryTask(
  deps: Pick<HandleConversationDeliveryDependencies, "db">,
  input: ClaimOrResumeConversationDeliveryTaskInput,
) {
  const activeTask = await findActiveConversationDeliveryTask(
    {
      db: deps.db,
    },
    {
      conversationId: input.conversationId,
      generation: input.generation,
    },
  );
  if (activeTask !== undefined) {
    if (activeTask.status === ConversationDeliveryTaskStatuses.CLAIMED) {
      return {
        taskId: activeTask.id,
        automationRunId: activeTask.automationRunId,
        status: ActiveConversationDeliveryTaskStatuses.CLAIMED,
      };
    }

    if (activeTask.status === ConversationDeliveryTaskStatuses.DELIVERING) {
      return {
        taskId: activeTask.id,
        automationRunId: activeTask.automationRunId,
        status: ActiveConversationDeliveryTaskStatuses.DELIVERING,
      };
    }

    throw new ConversationPersistenceError({
      code: ConversationPersistenceErrorCodes.CONVERSATION_DELIVERY_TASK_NOT_ACTIVE,
      message: `Conversation delivery task '${activeTask.id}' is in unexpected active status '${activeTask.status}'.`,
    });
  }

  const claimedTask = await claimNextConversationDeliveryTask(
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
    status: ActiveConversationDeliveryTaskStatuses.CLAIMED,
  };
}

export async function idleConversationDeliveryProcessor(
  deps: Pick<HandleConversationDeliveryDependencies, "db">,
  input: HandleConversationDeliveryWorkflowInput,
) {
  return idleConversationDeliveryProcessorIfEmpty(
    {
      db: deps.db,
    },
    input,
  );
}

export async function resolveConversationDeliveryActiveTaskAction(
  deps: Pick<HandleConversationDeliveryDependencies, "db">,
  input: {
    taskId: string;
    generation: number;
  },
) {
  return resolveConversationDeliveryTaskAction(
    {
      db: deps.db,
    },
    input,
  );
}

export async function prepareConversationDeliveryAutomationRun(
  deps: Pick<HandleConversationDeliveryDependencies, "db">,
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

export async function resolveConversationDeliveryRoute(
  deps: Pick<HandleConversationDeliveryDependencies, "db">,
  input: {
    conversationId: string;
  },
): Promise<ResolvedConversationDeliveryRoute> {
  const conversation = await deps.db.query.conversations.findFirst({
    where: (table, { eq }) => eq(table.id, input.conversationId),
  });
  if (conversation === undefined) {
    throw new ConversationPersistenceError({
      code: ConversationPersistenceErrorCodes.CONVERSATION_NOT_FOUND,
      message: `Conversation '${input.conversationId}' was not found.`,
    });
  }

  const route = await deps.db.query.conversationRoutes.findFirst({
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
    HandleConversationDeliveryDependencies,
    "db" | "getSandboxInstance" | "startSandboxProfileInstance"
  >,
  input: EnsureConversationDeliverySandboxServiceInput,
) {
  if (input.resolvedConversationRoute.sandboxInstanceId !== null) {
    const existingSandbox = await deps.getSandboxInstance({
      organizationId: input.preparedAutomationRun.organizationId,
      instanceId: input.resolvedConversationRoute.sandboxInstanceId,
    });

    const sandboxAction = resolveConversationDeliverySandboxAction({
      sandboxInstanceId: input.resolvedConversationRoute.sandboxInstanceId,
      sandboxStatus: existingSandbox.status,
    });

    if (sandboxAction === ConversationDeliverySandboxActions.REUSE_EXISTING) {
      return {
        sandboxInstanceId: existingSandbox.id,
        startupWorkflowRunId: null,
      };
    }
    if (sandboxAction === ConversationDeliverySandboxActions.FAIL) {
      throw new ConversationDeliveryExecutionError(
        `Conversation '${input.preparedAutomationRun.conversationId}' is bound to sandbox '${input.resolvedConversationRoute.sandboxInstanceId}', but that sandbox is '${existingSandbox.status}'.`,
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
    HandleConversationDeliveryDependencies,
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
  deps: Pick<HandleConversationDeliveryDependencies, "db">,
  input: DeliverConversationAutomationPayloadServiceInput & {
    taskId: string;
    generation: number;
  },
) {
  const task = await deps.db.query.conversationDeliveryTasks.findFirst({
    where: (table, { eq }) => eq(table.id, input.taskId),
  });
  if (task === undefined) {
    throw new ConversationPersistenceError({
      code: ConversationPersistenceErrorCodes.CONVERSATION_DELIVERY_TASK_NOT_FOUND,
      message: `Conversation delivery task '${input.taskId}' was not found.`,
    });
  }

  if (task.processorGeneration !== input.generation) {
    throw new ConversationPersistenceError({
      code: ConversationPersistenceErrorCodes.CONVERSATION_DELIVERY_TASK_NOT_ACTIVE,
      message: `Conversation delivery task '${input.taskId}' is not active for generation '${input.generation}'.`,
    });
  }

  if (task.status === ConversationDeliveryTaskStatuses.DELIVERING) {
    throw new Error(`Conversation delivery task '${input.taskId}' resumed after delivery started.`);
  }

  if (task.status !== ConversationDeliveryTaskStatuses.CLAIMED) {
    throw new ConversationPersistenceError({
      code: ConversationPersistenceErrorCodes.CONVERSATION_DELIVERY_TASK_NOT_CLAIMED,
      message: `Conversation delivery task '${input.taskId}' is not claimed by generation '${input.generation}'.`,
    });
  }

  await markConversationDeliveryTaskDelivering(
    {
      db: deps.db,
    },
    {
      taskId: input.taskId,
      generation: input.generation,
    },
  );

  const adapter = getConversationProviderAdapter(
    input.resolvedConversationRoute.integrationFamilyId,
  );
  const connection = await adapter.connect({
    connectionUrl: input.acquiredAutomationConnection.url,
    requestId: input.taskId,
  });

  try {
    const persistedRouteId = input.resolvedConversationRoute.routeId;
    let route =
      persistedRouteId === null
        ? await createConversationRoute(
            {
              db: deps.db,
            },
            {
              conversationId: input.preparedAutomationRun.conversationId,
              sandboxInstanceId: input.ensuredAutomationSandbox.sandboxInstanceId,
            },
          )
        : await deps.db.query.conversationRoutes.findFirst({
            where: (table, { eq }) => eq(table.id, persistedRouteId),
          });

    if (route === undefined) {
      throw new ConversationPersistenceError({
        code: ConversationPersistenceErrorCodes.CONVERSATION_ROUTE_NOT_FOUND,
        message: `Conversation route for conversation '${input.preparedAutomationRun.conversationId}' was not found.`,
      });
    }

    const routeBindingAction = resolveConversationRouteBindingAction({
      routeId: input.resolvedConversationRoute.routeId,
      routeSandboxInstanceId: route.sandboxInstanceId,
      providerConversationId: route.providerConversationId,
      ensuredSandboxInstanceId: input.ensuredAutomationSandbox.sandboxInstanceId,
    });

    switch (routeBindingAction) {
      case ConversationRouteBindingActions.CREATE_ROUTE:
      case ConversationRouteBindingActions.ACTIVATE_PENDING_ROUTE: {
        const createdConversation = await adapter.createConversation({
          connection,
        });

        route = await activateConversationRoute(
          {
            db: deps.db,
          },
          {
            conversationId: input.preparedAutomationRun.conversationId,
            routeId: route.id,
            sandboxInstanceId: input.ensuredAutomationSandbox.sandboxInstanceId,
            providerConversationId: createdConversation.providerConversationId,
            providerState: createdConversation.providerState,
          },
        );
        break;
      }
      case ConversationRouteBindingActions.REUSE_ACTIVE_ROUTE:
        break;
      case ConversationRouteBindingActions.FAIL_SANDBOX_MISMATCH:
        throw new ConversationDeliveryExecutionError(
          `Conversation '${input.preparedAutomationRun.conversationId}' is bound to sandbox '${route.sandboxInstanceId}', but delivery acquired sandbox '${input.ensuredAutomationSandbox.sandboxInstanceId}'.`,
        );
    }

    if (route.providerConversationId === null) {
      throw new ConversationDeliveryExecutionError(
        `Conversation '${input.preparedAutomationRun.conversationId}' is missing provider conversation id after route activation.`,
      );
    }

    const inspectResult = await adapter.inspectConversation({
      connection,
      providerConversationId: route.providerConversationId,
    });
    const executionAction = resolveConversationExecutionAction({
      inspectConversation: inspectResult,
      providerExecutionId: route.providerExecutionId,
      adapter,
    });

    let executionUpdate;
    switch (executionAction) {
      case ConversationExecutionActions.START:
        executionUpdate = await adapter.startExecution({
          connection,
          providerConversationId: route.providerConversationId,
          inputText: input.preparedAutomationRun.renderedInput,
        });
        break;
      case ConversationExecutionActions.STEER:
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
      case ConversationExecutionActions.FAIL_MISSING_CONVERSATION:
        throw new ConversationDeliveryExecutionError(
          `Conversation '${input.preparedAutomationRun.conversationId}' references missing provider conversation '${route.providerConversationId}'.`,
        );
      case ConversationExecutionActions.FAIL_PROVIDER_ERROR:
        throw new ConversationDeliveryExecutionError(
          `Conversation '${input.preparedAutomationRun.conversationId}' provider conversation '${route.providerConversationId}' is in error state.`,
        );
      case ConversationExecutionActions.FAIL_MISSING_EXECUTION:
        throw new ConversationDeliveryExecutionError(
          `Conversation '${input.preparedAutomationRun.conversationId}' is missing provider execution id while provider conversation '${route.providerConversationId}' is active.`,
        );
      case ConversationExecutionActions.FAIL_STEER_NOT_SUPPORTED:
        throw new ConversationDeliveryExecutionError(
          `Conversation integration family '${input.resolvedConversationRoute.integrationFamilyId}' does not support steering active execution for conversation '${input.preparedAutomationRun.conversationId}'.`,
        );
    }

    await updateConversationExecution(
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
  deps: Pick<HandleConversationDeliveryDependencies, "db">,
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

export async function ignoreConversationDeliveryAutomationRun(
  deps: Pick<HandleConversationDeliveryDependencies, "db">,
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
  deps: Pick<HandleConversationDeliveryDependencies, "db">,
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

export async function finalizeConversationDeliveryActiveTask(
  deps: Pick<HandleConversationDeliveryDependencies, "db">,
  input: {
    taskId: string;
    generation: number;
    status: "completed" | "failed" | "ignored";
    failureCode?: string | null;
    failureMessage?: string | null;
  },
) {
  await finalizeConversationDeliveryTask(
    {
      db: deps.db,
    },
    input,
  );
}

export { resolveAutomationRunFailure };
export { ConversationDeliveryTaskActions };
