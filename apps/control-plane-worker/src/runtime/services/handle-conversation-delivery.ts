import {
  ConversationDeliveryTaskStatuses,
  type ControlPlaneDatabase,
} from "@mistle/db/control-plane";
import type {
  HandleConversationDeliveryWorkflowInput,
  HandleConversationDeliveryWorkflowOutput,
} from "@mistle/workflows/control-plane";

import {
  claimNextConversationDeliveryTask,
  finalizeConversationDeliveryTask,
  idleConversationDeliveryProcessorIfEmpty,
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

export type HandleConversationDeliveryServiceInput = HandleConversationDeliveryWorkflowInput;
export type HandleConversationDeliveryServiceOutput = HandleConversationDeliveryWorkflowOutput;

export async function handleConversationDelivery(
  deps: HandleConversationDeliveryDependencies,
  input: HandleConversationDeliveryServiceInput,
): Promise<HandleConversationDeliveryServiceOutput> {
  while (true) {
    const claimedTask = await claimNextConversationDeliveryTask(
      {
        db: deps.db,
      },
      {
        conversationId: input.conversationId,
      },
    );

    if (claimedTask === null) {
      const didIdleProcessor = await idleConversationDeliveryProcessorIfEmpty(
        {
          db: deps.db,
        },
        {
          conversationId: input.conversationId,
          generation: input.generation,
        },
      );
      if (didIdleProcessor) {
        return {
          conversationId: input.conversationId,
          generation: input.generation,
        };
      }

      continue;
    }

    try {
      const preparedAutomationRun = await prepareAutomationRun(
        {
          db: deps.db,
        },
        {
          automationRunId: claimedTask.automationRunId,
        },
      );

      const ensuredAutomationSandbox = await ensureAutomationSandbox(
        {
          db: deps.db,
          startSandboxProfileInstance: deps.startSandboxProfileInstance,
        },
        {
          preparedAutomationRun,
        },
      );

      const acquiredAutomationConnection = await acquireAutomationConnection(
        {
          getSandboxInstance: deps.getSandboxInstance,
          mintSandboxConnectionToken: deps.mintSandboxConnectionToken,
        },
        {
          preparedAutomationRun,
          ensuredAutomationSandbox,
        },
      );

      await deliverAutomationPayload({
        preparedAutomationRun,
        ensuredAutomationSandbox,
        acquiredAutomationConnection,
      });

      await markAutomationRunCompleted(
        {
          db: deps.db,
        },
        {
          automationRunId: claimedTask.automationRunId,
        },
      );

      await finalizeConversationDeliveryTask(
        {
          db: deps.db,
        },
        {
          taskId: claimedTask.id,
          status: ConversationDeliveryTaskStatuses.COMPLETED,
        },
      );
    } catch (error) {
      const failure = resolveAutomationRunFailure(error);

      await markAutomationRunFailed(
        {
          db: deps.db,
        },
        {
          automationRunId: claimedTask.automationRunId,
          failureCode: failure.code,
          failureMessage: failure.message,
        },
      );

      await finalizeConversationDeliveryTask(
        {
          db: deps.db,
        },
        {
          taskId: claimedTask.id,
          status: ConversationDeliveryTaskStatuses.FAILED,
          failureCode: failure.code,
          failureMessage: failure.message,
        },
      );
    }
  }
}
