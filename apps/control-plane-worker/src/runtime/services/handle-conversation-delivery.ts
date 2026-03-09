import {
  ConversationDeliveryTaskStatuses,
  type ControlPlaneDatabase,
} from "@mistle/db/control-plane";
import {
  ActiveConversationDeliveryTaskStatuses,
  type HandleConversationDeliveryWorkflowInput,
} from "@mistle/workflows/control-plane";

import {
  claimNextConversationDeliveryTask,
  ConversationPersistenceError,
  ConversationPersistenceErrorCodes,
  finalizeConversationDeliveryTask,
  findActiveConversationDeliveryTask,
  idleConversationDeliveryProcessorIfEmpty,
  markConversationDeliveryTaskDelivering,
} from "../conversations/index.js";
import {
  acquireAutomationConnection,
  deliverAutomationPayload,
  ensureAutomationSandbox,
  markAutomationRunCompleted,
  markAutomationRunFailed,
  prepareAutomationRun,
  resolveAutomationRunFailure,
  type AcquireAutomationConnectionDependencies,
  type EnsureAutomationSandboxDependencies,
} from "./handle-automation-run.js";

export type HandleConversationDeliveryDependencies = {
  db: ControlPlaneDatabase;
  startSandboxProfileInstance: EnsureAutomationSandboxDependencies["startSandboxProfileInstance"];
  getSandboxInstance: AcquireAutomationConnectionDependencies["getSandboxInstance"];
  mintSandboxConnectionToken: AcquireAutomationConnectionDependencies["mintSandboxConnectionToken"];
};

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

export async function ensureConversationDeliverySandbox(
  deps: Pick<HandleConversationDeliveryDependencies, "db" | "startSandboxProfileInstance">,
  input: Parameters<typeof ensureAutomationSandbox>[1],
) {
  return ensureAutomationSandbox(
    {
      db: deps.db,
      startSandboxProfileInstance: deps.startSandboxProfileInstance,
    },
    input,
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
  input: {
    taskId: string;
    generation: number;
    preparedAutomationRun: Parameters<typeof deliverAutomationPayload>[0]["preparedAutomationRun"];
    ensuredAutomationSandbox: Parameters<
      typeof deliverAutomationPayload
    >[0]["ensuredAutomationSandbox"];
    acquiredAutomationConnection: Parameters<
      typeof deliverAutomationPayload
    >[0]["acquiredAutomationConnection"];
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

  await deliverAutomationPayload({
    preparedAutomationRun: input.preparedAutomationRun,
    ensuredAutomationSandbox: input.ensuredAutomationSandbox,
    acquiredAutomationConnection: input.acquiredAutomationConnection,
  });
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
