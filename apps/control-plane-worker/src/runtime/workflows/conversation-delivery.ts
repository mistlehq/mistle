import {
  AutomationConversationDeliveryTaskStatuses,
  type ControlPlaneDatabase,
} from "@mistle/db/control-plane";

import type {
  AcquiredAutomationConnection,
  ActiveAutomationConversationDeliveryTask,
  EnsuredAutomationSandbox,
  HandleAutomationConversationDeliveryWorkflowInput,
  ResolvedAutomationConversationDeliveryRoute,
  PreparedAutomationRun,
} from "../workflow-types.js";
import {
  acquireAutomationConnection,
  ensureAutomationSandbox,
  markAutomationRunCompleted,
  markAutomationRunFailed,
  markAutomationRunIgnored,
  prepareAutomationRun,
  type AcquireAutomationConnectionDependencies,
  type EnsureAutomationSandboxDependencies,
} from "./automation-run.js";
import {
  AutomationConversationRouteBindingActions,
  resolveAutomationConversationRouteBindingAction,
  AutomationConversationDeliverySandboxActions,
  resolveAutomationConversationDeliverySandboxAction,
} from "./conversation-delivery-planning.js";
import {
  activateAutomationConversationRoute,
  AutomationConversationDeliveryTaskActions,
  AutomationConversationPersistenceError,
  AutomationConversationPersistenceErrorCodes,
  claimNextAutomationConversationDeliveryTask,
  createAutomationConversationRoute,
  finalizeAutomationConversationDeliveryTask,
  findActiveAutomationConversationDeliveryTask,
  idleAutomationConversationDeliveryProcessorIfEmpty,
  markAutomationConversationDeliveryTaskDelivering,
  resolveAutomationConversationDeliveryTaskAction,
  updateAutomationConversationExecution,
} from "./persistence/index.js";

export type HandleAutomationConversationDeliveryDependencies = {
  db: ControlPlaneDatabase;
  startSandboxProfileInstance: EnsureAutomationSandboxDependencies["startSandboxProfileInstance"];
  getSandboxInstance: AcquireAutomationConnectionDependencies["getSandboxInstance"];
  mintSandboxConnectionToken: AcquireAutomationConnectionDependencies["mintSandboxConnectionToken"];
};

export type ExecuteConversationProviderDeliveryInput = {
  conversationId: string;
  integrationFamilyId: string;
  connectionUrl: string;
  inputText: string;
  providerConversationId: string | null;
  providerExecutionId: string | null;
};

export type ExecutedConversationProviderDelivery = {
  providerConversationId: string;
  providerExecutionId: string | null;
  providerState?: unknown;
};

export type ClaimOrResumeAutomationConversationDeliveryTaskInput =
  HandleAutomationConversationDeliveryWorkflowInput;

export async function claimOrResumeAutomationConversationDeliveryTask(
  ctx: Pick<HandleAutomationConversationDeliveryDependencies, "db">,
  input: ClaimOrResumeAutomationConversationDeliveryTaskInput,
): Promise<ActiveAutomationConversationDeliveryTask | null> {
  const activeTask = await findActiveAutomationConversationDeliveryTask(
    {
      db: ctx.db,
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
        status: "claimed",
      };
    }

    if (activeTask.status === AutomationConversationDeliveryTaskStatuses.DELIVERING) {
      return {
        taskId: activeTask.id,
        automationRunId: activeTask.automationRunId,
        status: "delivering",
      };
    }

    throw new AutomationConversationPersistenceError({
      code: AutomationConversationPersistenceErrorCodes.CONVERSATION_DELIVERY_TASK_NOT_ACTIVE,
      message: `AutomationConversation delivery task '${activeTask.id}' is in unexpected active status '${activeTask.status}'.`,
    });
  }

  const claimedTask = await claimNextAutomationConversationDeliveryTask(
    {
      db: ctx.db,
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
    status: "claimed",
  };
}

export async function idleAutomationConversationDeliveryProcessor(
  ctx: Pick<HandleAutomationConversationDeliveryDependencies, "db">,
  input: HandleAutomationConversationDeliveryWorkflowInput,
): Promise<boolean> {
  return idleAutomationConversationDeliveryProcessorIfEmpty(
    {
      db: ctx.db,
    },
    input,
  );
}

export async function resolveAutomationConversationDeliveryActiveTaskAction(
  ctx: Pick<HandleAutomationConversationDeliveryDependencies, "db">,
  input: {
    taskId: string;
    generation: number;
  },
) {
  return resolveAutomationConversationDeliveryTaskAction(
    {
      db: ctx.db,
    },
    input,
  );
}

export async function prepareConversationDeliveryAutomationRun(
  ctx: Pick<HandleAutomationConversationDeliveryDependencies, "db">,
  input: { automationRunId: string },
): Promise<PreparedAutomationRun> {
  return prepareAutomationRun(
    {
      db: ctx.db,
    },
    {
      automationRunId: input.automationRunId,
    },
  );
}

export async function resolveAutomationConversationDeliveryRoute(
  ctx: Pick<HandleAutomationConversationDeliveryDependencies, "db">,
  input: {
    conversationId: string;
  },
): Promise<ResolvedAutomationConversationDeliveryRoute> {
  const conversation = await ctx.db.query.automationConversations.findFirst({
    where: (table, { eq }) => eq(table.id, input.conversationId),
  });
  if (conversation === undefined) {
    throw new AutomationConversationPersistenceError({
      code: AutomationConversationPersistenceErrorCodes.CONVERSATION_NOT_FOUND,
      message: `AutomationConversation '${input.conversationId}' was not found.`,
    });
  }

  const route = await ctx.db.query.automationConversationRoutes.findFirst({
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
  ctx: Pick<
    HandleAutomationConversationDeliveryDependencies,
    "db" | "getSandboxInstance" | "startSandboxProfileInstance"
  >,
  input: {
    preparedAutomationRun: PreparedAutomationRun;
    resolvedAutomationConversationRoute: ResolvedAutomationConversationDeliveryRoute;
  },
): Promise<EnsuredAutomationSandbox> {
  if (input.resolvedAutomationConversationRoute.sandboxInstanceId !== null) {
    const existingSandbox = await ctx.getSandboxInstance({
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
      throw new Error(
        `AutomationConversation '${input.preparedAutomationRun.conversationId}' is bound to sandbox '${input.resolvedAutomationConversationRoute.sandboxInstanceId}', but that sandbox is '${existingSandbox.status}'.`,
      );
    }
  }

  return ensureAutomationSandbox(
    {
      db: ctx.db,
      startSandboxProfileInstance: ctx.startSandboxProfileInstance,
    },
    {
      preparedAutomationRun: input.preparedAutomationRun,
    },
  );
}

export async function acquireConversationDeliveryConnection(
  ctx: Pick<
    HandleAutomationConversationDeliveryDependencies,
    "getSandboxInstance" | "mintSandboxConnectionToken"
  >,
  input: {
    preparedAutomationRun: PreparedAutomationRun;
    ensuredAutomationSandbox: EnsuredAutomationSandbox;
  },
): Promise<AcquiredAutomationConnection> {
  return acquireAutomationConnection(
    {
      getSandboxInstance: ctx.getSandboxInstance,
      mintSandboxConnectionToken: ctx.mintSandboxConnectionToken,
    },
    input,
  );
}

export async function deliverConversationAutomationPayload(
  ctx: Pick<HandleAutomationConversationDeliveryDependencies, "db"> & {
    executeConversationProviderDelivery: (
      input: ExecuteConversationProviderDeliveryInput,
    ) => Promise<ExecutedConversationProviderDelivery>;
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

  const deliveryResult = await ctx.executeConversationProviderDelivery({
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

export async function completeConversationDeliveryAutomationRun(
  ctx: Pick<HandleAutomationConversationDeliveryDependencies, "db">,
  input: {
    automationRunId: string;
  },
): Promise<void> {
  await markAutomationRunCompleted(
    {
      db: ctx.db,
    },
    input,
  );
}

export async function ignoreAutomationConversationDeliveryAutomationRun(
  ctx: Pick<HandleAutomationConversationDeliveryDependencies, "db">,
  input: {
    automationRunId: string;
  },
): Promise<void> {
  await markAutomationRunIgnored(
    {
      db: ctx.db,
    },
    input,
  );
}

export async function failConversationDeliveryAutomationRun(
  ctx: Pick<HandleAutomationConversationDeliveryDependencies, "db">,
  input: {
    automationRunId: string;
    failureCode: string;
    failureMessage: string;
  },
): Promise<void> {
  await markAutomationRunFailed(
    {
      db: ctx.db,
    },
    input,
  );
}

export async function finalizeAutomationConversationDeliveryActiveTask(
  ctx: Pick<HandleAutomationConversationDeliveryDependencies, "db">,
  input: {
    taskId: string;
    generation: number;
    status: "completed" | "failed" | "ignored";
    failureCode?: string | null;
    failureMessage?: string | null;
  },
): Promise<void> {
  await finalizeAutomationConversationDeliveryTask(
    {
      db: ctx.db,
    },
    input,
  );
}

export { AutomationConversationDeliveryTaskActions };
