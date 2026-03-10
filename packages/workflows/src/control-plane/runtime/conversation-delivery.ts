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
} from "../workflows/handle-automation-conversation-delivery/index.js";
import type { PreparedAutomationRun } from "../workflows/handle-automation-run/index.js";
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
  AutomationConversationDeliverySandboxActions,
  resolveAutomationConversationDeliverySandboxAction,
} from "./conversation-delivery-planning.js";
import {
  AutomationConversationDeliveryTaskActions,
  AutomationConversationPersistenceError,
  AutomationConversationPersistenceErrorCodes,
  claimNextAutomationConversationDeliveryTask,
  finalizeAutomationConversationDeliveryTask,
  findActiveAutomationConversationDeliveryTask,
  idleAutomationConversationDeliveryProcessorIfEmpty,
  resolveAutomationConversationDeliveryTaskAction,
} from "./persistence/index.js";

export type HandleAutomationConversationDeliveryDependencies = {
  db: ControlPlaneDatabase;
  startSandboxProfileInstance: EnsureAutomationSandboxDependencies["startSandboxProfileInstance"];
  getSandboxInstance: AcquireAutomationConnectionDependencies["getSandboxInstance"];
  mintSandboxConnectionToken: AcquireAutomationConnectionDependencies["mintSandboxConnectionToken"];
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
