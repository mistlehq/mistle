import {
  automationRuns,
  AutomationRunStatuses,
  conversationDeliveryProcessors,
  ConversationDeliveryProcessorStatuses,
  conversationDeliveryTasks,
  ConversationDeliveryTaskStatuses,
  conversations,
  ConversationRouteStatuses,
  ConversationStatuses,
  IntegrationBindingKinds,
  type ControlPlaneDatabase,
} from "@mistle/db/control-plane";
import { systemSleeper } from "@mistle/time";
import type { HandleConversationDeliveryWorkflowInput } from "@mistle/workflows/control-plane";
import { and, eq, sql } from "drizzle-orm";

import {
  activateConversationRoute,
  ConversationPersistenceError,
  ConversationPersistenceErrorCodes,
  ConversationProviderError,
  ConversationProviderErrorCodes,
  createConversationRoute,
  getConversationProviderAdapter,
  rebindConversationSandbox,
  updateConversationExecution,
} from "../conversations/index.js";
import type {
  HandleConversationDeliveryServiceDependencies,
  HandleConversationDeliveryServiceOutput,
} from "./types.js";

const SandboxStartTimeoutMs = 5 * 60 * 1000;
const SandboxStartPollIntervalMs = 1_000;

const ConversationDeliveryFailureCodes = {
  AUTOMATION_RUN_NOT_FOUND: "automation_run_not_found",
  AUTOMATION_NOT_FOUND: "automation_not_found",
  AUTOMATION_TARGET_REFERENCE_MISSING: "automation_target_reference_missing",
  AUTOMATION_TARGET_NOT_FOUND: "automation_target_not_found",
  AUTOMATION_TARGET_BINDING_AMBIGUOUS: "automation_target_binding_ambiguous",
  AUTOMATION_TARGET_BINDING_MISSING: "automation_target_binding_missing",
  AUTOMATION_TARGET_BINDING_INVALID: "automation_target_binding_invalid",
  CONVERSATION_NOT_FOUND: "conversation_not_found",
  CONVERSATION_ROUTE_NOT_FOUND: "conversation_route_not_found",
  CONVERSATION_RECOVERY_FAILED: "conversation_recovery_failed",
  CONVERSATION_REQUIRES_MANUAL_RECOVERY: "conversation_requires_manual_recovery",
  TEMPLATE_RENDER_FAILED: "template_render_failed",
  WEBHOOK_EVENT_NOT_FOUND: "webhook_event_not_found",
} as const;

class ConversationDeliveryExecutionError extends Error {
  readonly code: string;

  constructor(input: { code: string; message: string; cause?: unknown }) {
    super(input.message, {
      cause: input.cause,
    });
    this.code = input.code;
  }
}

function resolveConversationDeliveryFailure(input: unknown): { code: string; message: string } {
  if (input instanceof ConversationDeliveryExecutionError) {
    return {
      code: input.code,
      message: input.message,
    };
  }

  if (input instanceof ConversationPersistenceError || input instanceof ConversationProviderError) {
    return {
      code: input.code,
      message: input.message,
    };
  }

  if (input instanceof Error) {
    return {
      code: ConversationDeliveryFailureCodes.CONVERSATION_RECOVERY_FAILED,
      message: input.message,
    };
  }

  return {
    code: ConversationDeliveryFailureCodes.CONVERSATION_RECOVERY_FAILED,
    message: "Conversation delivery failed with a non-error exception.",
  };
}

function isNotFoundControlPlaneSandboxError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.message.includes("status 404");
}

type ClaimedConversationDeliveryTask =
  | {
      type: "stale";
    }
  | {
      type: "empty";
    }
  | {
      type: "blocked";
    }
  | {
      type: "processing-recovery";
      taskId: string;
    }
  | {
      type: "task";
      taskId: string;
    };

type LoadedConversationDeliveryTask = {
  task: typeof conversationDeliveryTasks.$inferSelect;
  automationRun: typeof automationRuns.$inferSelect;
  conversation: typeof conversations.$inferSelect;
  automation: {
    id: string;
    organizationId: string;
  };
  webhookEvent: {
    id: string;
  };
};

type PreparedConversationDelivery = {
  routeId: string;
  sandboxInstanceId: string;
  providerConversationId: string;
  providerExecutionId: string | null;
  providerStatus: "idle" | "active";
  resumeRequired: boolean;
};

async function claimNextConversationDeliveryTask(
  db: ControlPlaneDatabase,
  input: HandleConversationDeliveryWorkflowInput,
): Promise<ClaimedConversationDeliveryTask> {
  return db.transaction(async (transaction) => {
    const processor = await transaction.query.conversationDeliveryProcessors.findFirst({
      where: (table, { eq: whereEq }) => whereEq(table.conversationId, input.conversationId),
    });
    if (
      processor === undefined ||
      processor.generation !== input.generation ||
      processor.status !== ConversationDeliveryProcessorStatuses.RUNNING
    ) {
      return {
        type: "stale",
      };
    }

    const blockingFailedTask = await transaction.query.conversationDeliveryTasks.findFirst({
      columns: {
        id: true,
      },
      where: (table, { and: whereAnd, eq: whereEq }) =>
        whereAnd(
          whereEq(table.conversationId, input.conversationId),
          whereEq(table.status, ConversationDeliveryTaskStatuses.FAILED),
        ),
    });
    if (blockingFailedTask !== undefined) {
      return {
        type: "blocked",
      };
    }

    const processingTask = await transaction.query.conversationDeliveryTasks.findFirst({
      columns: {
        id: true,
      },
      where: (table, { and: whereAnd, eq: whereEq }) =>
        whereAnd(
          whereEq(table.conversationId, input.conversationId),
          whereEq(table.status, ConversationDeliveryTaskStatuses.PROCESSING),
        ),
      orderBy: (table, { asc }) => [asc(table.sourceOrderKey), asc(table.createdAt), asc(table.id)],
    });
    if (processingTask !== undefined) {
      return {
        type: "processing-recovery",
        taskId: processingTask.id,
      };
    }

    const nextTask = await transaction.query.conversationDeliveryTasks.findFirst({
      where: (table, { and: whereAnd, eq: whereEq }) =>
        whereAnd(
          whereEq(table.conversationId, input.conversationId),
          whereEq(table.status, ConversationDeliveryTaskStatuses.QUEUED),
        ),
      orderBy: (table, { asc }) => [asc(table.sourceOrderKey), asc(table.createdAt), asc(table.id)],
    });
    if (nextTask === undefined) {
      return {
        type: "empty",
      };
    }

    await transaction
      .update(conversationDeliveryTasks)
      .set({
        status: ConversationDeliveryTaskStatuses.PROCESSING,
        startedAt: sql`coalesce(${conversationDeliveryTasks.startedAt}, now())`,
        updatedAt: sql`now()`,
      })
      .where(eq(conversationDeliveryTasks.id, nextTask.id));

    return {
      type: "task",
      taskId: nextTask.id,
    };
  });
}

async function releaseConversationDeliveryProcessor(
  db: ControlPlaneDatabase,
  input: HandleConversationDeliveryWorkflowInput,
) {
  await db
    .update(conversationDeliveryProcessors)
    .set({
      status: ConversationDeliveryProcessorStatuses.IDLE,
      activeWorkflowRunId: null,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(conversationDeliveryProcessors.conversationId, input.conversationId),
        eq(conversationDeliveryProcessors.generation, input.generation),
        eq(conversationDeliveryProcessors.status, ConversationDeliveryProcessorStatuses.RUNNING),
      ),
    );
}

async function markConversationDeliveryProcessorIdleIfEmpty(
  db: ControlPlaneDatabase,
  input: HandleConversationDeliveryWorkflowInput,
): Promise<boolean> {
  return db.transaction(async (transaction) => {
    const nextTask = await transaction.query.conversationDeliveryTasks.findFirst({
      columns: {
        id: true,
      },
      where: (table, { and: whereAnd, eq: whereEq, inArray: whereInArray }) =>
        whereAnd(
          whereEq(table.conversationId, input.conversationId),
          whereInArray(table.status, [
            ConversationDeliveryTaskStatuses.QUEUED,
            ConversationDeliveryTaskStatuses.PROCESSING,
          ]),
        ),
    });
    if (nextTask !== undefined) {
      return false;
    }

    await releaseConversationDeliveryProcessor(transaction, input);

    return true;
  });
}

async function loadAutomationTargetSandboxProfileVersion(
  db: ControlPlaneDatabase,
  input: {
    automationTargetId: string;
  },
): Promise<number> {
  const automationTarget = await db.query.automationTargets.findFirst({
    columns: {
      id: true,
      sandboxProfileVersion: true,
    },
    where: (table, { eq }) => eq(table.id, input.automationTargetId),
  });
  if (automationTarget === undefined) {
    throw new ConversationDeliveryExecutionError({
      code: ConversationDeliveryFailureCodes.AUTOMATION_TARGET_NOT_FOUND,
      message: `Automation target '${input.automationTargetId}' was not found.`,
    });
  }

  const sandboxProfileVersion = automationTarget.sandboxProfileVersion;
  if (sandboxProfileVersion === null) {
    throw new ConversationDeliveryExecutionError({
      code: ConversationDeliveryFailureCodes.AUTOMATION_TARGET_BINDING_INVALID,
      message: `Automation target '${automationTarget.id}' does not define a sandbox profile version.`,
    });
  }

  return sandboxProfileVersion;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function loadAutomationTargetProviderModel(
  db: ControlPlaneDatabase,
  input: {
    sandboxProfileId: string;
    sandboxProfileVersion: number;
  },
): Promise<string> {
  const agentBindings = await db.query.sandboxProfileVersionIntegrationBindings.findMany({
    where: (table, { and, eq }) =>
      and(
        eq(table.sandboxProfileId, input.sandboxProfileId),
        eq(table.sandboxProfileVersion, input.sandboxProfileVersion),
        eq(table.kind, IntegrationBindingKinds.AGENT),
      ),
  });
  if (agentBindings.length === 0) {
    throw new ConversationDeliveryExecutionError({
      code: ConversationDeliveryFailureCodes.AUTOMATION_TARGET_BINDING_MISSING,
      message: `Sandbox profile '${input.sandboxProfileId}' version '${String(input.sandboxProfileVersion)}' does not have an agent integration binding.`,
    });
  }
  if (agentBindings.length > 1) {
    throw new ConversationDeliveryExecutionError({
      code: ConversationDeliveryFailureCodes.AUTOMATION_TARGET_BINDING_AMBIGUOUS,
      message: `Sandbox profile '${input.sandboxProfileId}' version '${String(input.sandboxProfileVersion)}' has multiple agent integration bindings.`,
    });
  }

  const agentBinding = agentBindings[0];
  if (agentBinding === undefined) {
    throw new ConversationDeliveryExecutionError({
      code: ConversationDeliveryFailureCodes.AUTOMATION_TARGET_BINDING_MISSING,
      message: "Expected an agent integration binding but none was available.",
    });
  }

  if (!isRecord(agentBinding.config)) {
    throw new ConversationDeliveryExecutionError({
      code: ConversationDeliveryFailureCodes.AUTOMATION_TARGET_BINDING_INVALID,
      message: "Automation target binding config must be an object.",
    });
  }

  const defaultModelValue = agentBinding.config.defaultModel;
  if (typeof defaultModelValue !== "string" || defaultModelValue.trim().length === 0) {
    throw new ConversationDeliveryExecutionError({
      code: ConversationDeliveryFailureCodes.AUTOMATION_TARGET_BINDING_INVALID,
      message: "Automation target binding config.defaultModel must be a non-empty string.",
    });
  }

  return defaultModelValue;
}

async function loadConversationDeliveryTask(
  db: ControlPlaneDatabase,
  input: {
    conversationId: string;
    taskId: string;
  },
): Promise<LoadedConversationDeliveryTask> {
  const task = await db.query.conversationDeliveryTasks.findFirst({
    where: (table, { and: whereAnd }) =>
      whereAnd(eq(table.id, input.taskId), eq(table.conversationId, input.conversationId)),
  });
  if (task === undefined) {
    throw new ConversationDeliveryExecutionError({
      code: ConversationDeliveryFailureCodes.CONVERSATION_ROUTE_NOT_FOUND,
      message: `Conversation delivery task '${input.taskId}' was not found.`,
    });
  }

  const automationRun = await db.query.automationRuns.findFirst({
    where: (table, { eq: whereEq }) => whereEq(table.id, task.automationRunId),
  });
  if (automationRun === undefined) {
    throw new ConversationDeliveryExecutionError({
      code: ConversationDeliveryFailureCodes.AUTOMATION_RUN_NOT_FOUND,
      message: `Automation run '${task.automationRunId}' was not found.`,
    });
  }
  if (
    automationRun.conversationId === null ||
    automationRun.conversationId !== input.conversationId ||
    automationRun.renderedInput === null ||
    automationRun.renderedConversationKey === null
  ) {
    throw new ConversationDeliveryExecutionError({
      code: ConversationDeliveryFailureCodes.TEMPLATE_RENDER_FAILED,
      message: `Automation run '${automationRun.id}' does not have frozen delivery state.`,
    });
  }

  const conversationId = automationRun.conversationId;

  const conversation = await db.query.conversations.findFirst({
    where: (table, { eq: whereEq }) => whereEq(table.id, conversationId),
  });
  if (conversation === undefined) {
    throw new ConversationDeliveryExecutionError({
      code: ConversationDeliveryFailureCodes.CONVERSATION_NOT_FOUND,
      message: `Conversation '${automationRun.conversationId}' was not found.`,
    });
  }

  const automation = await db.query.automations.findFirst({
    columns: {
      id: true,
      organizationId: true,
    },
    where: (table, { eq: whereEq }) => whereEq(table.id, automationRun.automationId),
  });
  if (automation === undefined) {
    throw new ConversationDeliveryExecutionError({
      code: ConversationDeliveryFailureCodes.AUTOMATION_NOT_FOUND,
      message: `Automation '${automationRun.automationId}' was not found.`,
    });
  }

  const webhookEvent = await db.query.integrationWebhookEvents.findFirst({
    columns: {
      id: true,
    },
    where: (table, { eq: whereEq }) => whereEq(table.id, task.sourceWebhookEventId),
  });
  if (webhookEvent === undefined) {
    throw new ConversationDeliveryExecutionError({
      code: ConversationDeliveryFailureCodes.WEBHOOK_EVENT_NOT_FOUND,
      message: `Webhook event '${task.sourceWebhookEventId}' was not found.`,
    });
  }

  return {
    task,
    automationRun,
    conversation,
    automation,
    webhookEvent,
  };
}

async function waitForSandboxInstanceRunning(
  deps: Pick<HandleConversationDeliveryServiceDependencies, "getSandboxInstance">,
  input: {
    organizationId: string;
    sandboxInstanceId: string;
    timeoutMs?: number;
  },
): Promise<void> {
  const timeoutMs = input.timeoutMs ?? SandboxStartTimeoutMs;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const sandboxInstance = await deps.getSandboxInstance({
      organizationId: input.organizationId,
      instanceId: input.sandboxInstanceId,
    });

    if (sandboxInstance.status === "running") {
      return;
    }

    if (sandboxInstance.status === "failed") {
      throw new ConversationDeliveryExecutionError({
        code: ConversationDeliveryFailureCodes.CONVERSATION_RECOVERY_FAILED,
        message:
          sandboxInstance.failureMessage ??
          `Sandbox instance '${sandboxInstance.id}' entered terminal status '${sandboxInstance.status}'.`,
      });
    }

    if (sandboxInstance.status === "stopped") {
      throw new ConversationDeliveryExecutionError({
        code: ConversationDeliveryFailureCodes.CONVERSATION_RECOVERY_FAILED,
        message:
          sandboxInstance.failureMessage ??
          `Sandbox instance '${sandboxInstance.id}' entered terminal status '${sandboxInstance.status}'.`,
      });
    }

    await systemSleeper.sleep(SandboxStartPollIntervalMs);
  }

  throw new ConversationDeliveryExecutionError({
    code: ConversationDeliveryFailureCodes.CONVERSATION_RECOVERY_FAILED,
    message: `Sandbox instance '${input.sandboxInstanceId}' did not become ready before timeout elapsed.`,
  });
}

async function startAndWaitForSandbox(
  deps: Pick<
    HandleConversationDeliveryServiceDependencies,
    "startSandboxProfileInstance" | "getSandboxInstance"
  >,
  input: {
    organizationId: string;
    sandboxProfileId: string;
    sandboxProfileVersion: number;
    automationRunId: string;
  },
): Promise<{
  sandboxInstanceId: string;
  workflowRunId: string;
}> {
  const startedSandbox = await deps.startSandboxProfileInstance({
    organizationId: input.organizationId,
    profileId: input.sandboxProfileId,
    profileVersion: input.sandboxProfileVersion,
    startedBy: {
      kind: "system",
      id: input.automationRunId,
    },
    source: "webhook",
  });

  await waitForSandboxInstanceRunning(
    {
      getSandboxInstance: deps.getSandboxInstance,
    },
    {
      organizationId: input.organizationId,
      sandboxInstanceId: startedSandbox.sandboxInstanceId,
    },
  );

  return {
    sandboxInstanceId: startedSandbox.sandboxInstanceId,
    workflowRunId: startedSandbox.workflowRunId,
  };
}

async function resolveRouteSandboxStatus(
  deps: Pick<HandleConversationDeliveryServiceDependencies, "getSandboxInstance">,
  input: {
    organizationId: string;
    sandboxInstanceId: string;
  },
): Promise<"running" | "starting" | "stopped" | "failed" | "missing"> {
  try {
    const sandbox = await deps.getSandboxInstance({
      organizationId: input.organizationId,
      instanceId: input.sandboxInstanceId,
    });

    return sandbox.status;
  } catch (error) {
    if (isNotFoundControlPlaneSandboxError(error)) {
      return "missing";
    }

    throw new ConversationDeliveryExecutionError({
      code: ConversationDeliveryFailureCodes.CONVERSATION_RECOVERY_FAILED,
      message:
        error instanceof Error
          ? error.message
          : `Failed to read sandbox instance '${input.sandboxInstanceId}'.`,
      cause: error,
    });
  }
}

async function withConversationProviderConnection<TOutput>(
  deps: Pick<HandleConversationDeliveryServiceDependencies, "mintSandboxConnectionToken">,
  input: {
    organizationId: string;
    sandboxInstanceId: string;
    providerFamily: LoadedConversationDeliveryTask["conversation"]["providerFamily"];
  },
  callback: (context: {
    adapter: ReturnType<typeof getConversationProviderAdapter>;
    connection: Awaited<ReturnType<ReturnType<typeof getConversationProviderAdapter>["connect"]>>;
  }) => Promise<TOutput>,
): Promise<TOutput> {
  const adapter = getConversationProviderAdapter(input.providerFamily);
  const mintedConnection = await deps.mintSandboxConnectionToken({
    organizationId: input.organizationId,
    instanceId: input.sandboxInstanceId,
  });
  if (mintedConnection.url.trim().length === 0) {
    throw new ConversationDeliveryExecutionError({
      code: ConversationDeliveryFailureCodes.CONVERSATION_RECOVERY_FAILED,
      message: "Sandbox connection URL must not be empty.",
    });
  }

  const connection = await adapter.connect({
    connectionUrl: mintedConnection.url,
  });

  try {
    return await callback({
      adapter,
      connection,
    });
  } finally {
    await connection.close();
  }
}

async function loadConversationDeliverySandboxProfileVersion(
  db: ControlPlaneDatabase,
  input: {
    automationRunId: string;
    automationTargetId: string | null;
  },
): Promise<number> {
  if (input.automationTargetId === null) {
    throw new ConversationDeliveryExecutionError({
      code: ConversationDeliveryFailureCodes.AUTOMATION_TARGET_REFERENCE_MISSING,
      message: `Automation run '${input.automationRunId}' no longer references an automation target required for sandbox recovery.`,
    });
  }

  return loadAutomationTargetSandboxProfileVersion(db, {
    automationTargetId: input.automationTargetId,
  });
}

async function ensureConversationDeliverySandbox(
  deps: HandleConversationDeliveryServiceDependencies,
  input: LoadedConversationDeliveryTask,
): Promise<{
  routeId: string | null;
  sandboxInstanceId: string;
  providerConversationId: string | null;
  providerExecutionId: string | null;
}> {
  const existingRoute = await deps.db.query.conversationRoutes.findFirst({
    where: (table, { eq: whereEq }) => whereEq(table.conversationId, input.conversation.id),
  });

  if (existingRoute === undefined) {
    const sandboxProfileVersion = await loadConversationDeliverySandboxProfileVersion(deps.db, {
      automationRunId: input.automationRun.id,
      automationTargetId: input.automationRun.automationTargetId,
    });
    const startedSandbox = await startAndWaitForSandbox(deps, {
      organizationId: input.automation.organizationId,
      sandboxProfileId: input.conversation.sandboxProfileId,
      sandboxProfileVersion,
      automationRunId: input.automationRun.id,
    });

    return {
      routeId: null,
      sandboxInstanceId: startedSandbox.sandboxInstanceId,
      providerConversationId: null,
      providerExecutionId: null,
    };
  }

  if (existingRoute.status === ConversationRouteStatuses.CLOSED) {
    throw new ConversationPersistenceError({
      code: ConversationPersistenceErrorCodes.CONVERSATION_ROUTE_CLOSED,
      message: `Conversation route '${existingRoute.id}' is closed and cannot be reused.`,
    });
  }

  const routeSandboxStatus = await resolveRouteSandboxStatus(
    {
      getSandboxInstance: deps.getSandboxInstance,
    },
    {
      organizationId: input.automation.organizationId,
      sandboxInstanceId: existingRoute.sandboxInstanceId,
    },
  );

  if (routeSandboxStatus === "running") {
    return {
      routeId: existingRoute.id,
      sandboxInstanceId: existingRoute.sandboxInstanceId,
      providerConversationId: existingRoute.providerConversationId,
      providerExecutionId: existingRoute.providerExecutionId,
    };
  }

  if (routeSandboxStatus === "starting") {
    await waitForSandboxInstanceRunning(
      {
        getSandboxInstance: deps.getSandboxInstance,
      },
      {
        organizationId: input.automation.organizationId,
        sandboxInstanceId: existingRoute.sandboxInstanceId,
      },
    );

    return {
      routeId: existingRoute.id,
      sandboxInstanceId: existingRoute.sandboxInstanceId,
      providerConversationId: existingRoute.providerConversationId,
      providerExecutionId: existingRoute.providerExecutionId,
    };
  }

  const sandboxProfileVersion = await loadConversationDeliverySandboxProfileVersion(deps.db, {
    automationRunId: input.automationRun.id,
    automationTargetId: input.automationRun.automationTargetId,
  });
  const startedSandbox = await startAndWaitForSandbox(deps, {
    organizationId: input.automation.organizationId,
    sandboxProfileId: input.conversation.sandboxProfileId,
    sandboxProfileVersion,
    automationRunId: input.automationRun.id,
  });

  const reboundRoute = await rebindConversationSandbox(
    {
      db: deps.db,
    },
    {
      routeId: existingRoute.id,
      sandboxInstanceId: startedSandbox.sandboxInstanceId,
    },
  );

  return {
    routeId: reboundRoute.id,
    sandboxInstanceId: reboundRoute.sandboxInstanceId,
    providerConversationId: reboundRoute.providerConversationId,
    providerExecutionId: reboundRoute.providerExecutionId,
  };
}

async function ensureConversationDeliveryRoute(
  db: ControlPlaneDatabase,
  input: LoadedConversationDeliveryTask,
  sandbox: Awaited<ReturnType<typeof ensureConversationDeliverySandbox>>,
): Promise<{
  routeId: string;
  sandboxInstanceId: string;
  providerConversationId: string | null;
  providerExecutionId: string | null;
}> {
  if (sandbox.routeId !== null) {
    return {
      routeId: sandbox.routeId,
      sandboxInstanceId: sandbox.sandboxInstanceId,
      providerConversationId: sandbox.providerConversationId,
      providerExecutionId: sandbox.providerExecutionId,
    };
  }

  const route = await createConversationRoute(
    {
      db,
    },
    {
      conversationId: input.conversation.id,
      sandboxInstanceId: sandbox.sandboxInstanceId,
    },
  );

  return {
    routeId: route.id,
    sandboxInstanceId: route.sandboxInstanceId,
    providerConversationId: route.providerConversationId,
    providerExecutionId: route.providerExecutionId,
  };
}

async function ensureConversationDeliveryBinding(
  deps: HandleConversationDeliveryServiceDependencies,
  input: LoadedConversationDeliveryTask,
  route: Awaited<ReturnType<typeof ensureConversationDeliveryRoute>>,
): Promise<PreparedConversationDelivery> {
  return withConversationProviderConnection(
    {
      mintSandboxConnectionToken: deps.mintSandboxConnectionToken,
    },
    {
      organizationId: input.automation.organizationId,
      sandboxInstanceId: route.sandboxInstanceId,
      providerFamily: input.conversation.providerFamily,
    },
    async ({ adapter, connection }) => {
      if (route.providerConversationId === null) {
        const sandboxProfileVersion = await loadConversationDeliverySandboxProfileVersion(deps.db, {
          automationRunId: input.automationRun.id,
          automationTargetId: input.automationRun.automationTargetId,
        });
        const providerModel = await loadAutomationTargetProviderModel(deps.db, {
          sandboxProfileId: input.conversation.sandboxProfileId,
          sandboxProfileVersion,
        });

        const createdConversation = await adapter.createConversation({
          connection,
          options: {
            model: providerModel,
          },
        });

        const activatedRoute = await activateConversationRoute(
          {
            db: deps.db,
          },
          {
            conversationId: input.conversation.id,
            routeId: route.routeId,
            sandboxInstanceId: route.sandboxInstanceId,
            providerConversationId: createdConversation.providerConversationId,
            providerExecutionId: null,
            ...(createdConversation.providerState === undefined
              ? {}
              : {
                  providerState: createdConversation.providerState,
                }),
          },
        );

        return {
          routeId: activatedRoute.id,
          sandboxInstanceId: activatedRoute.sandboxInstanceId,
          providerConversationId: createdConversation.providerConversationId,
          providerExecutionId: activatedRoute.providerExecutionId,
          providerStatus: "idle",
          resumeRequired: false,
        };
      }

      const inspectedConversation = await adapter.inspectConversation({
        connection,
        providerConversationId: route.providerConversationId,
      });
      if (inspectedConversation.status === "error") {
        throw new ConversationDeliveryExecutionError({
          code: ConversationDeliveryFailureCodes.CONVERSATION_RECOVERY_FAILED,
          message: `Provider conversation '${route.providerConversationId}' is in error state.`,
        });
      }

      if (!inspectedConversation.exists) {
        throw new ConversationDeliveryExecutionError({
          code: ConversationDeliveryFailureCodes.CONVERSATION_RECOVERY_FAILED,
          message: `Provider conversation '${route.providerConversationId}' for route '${route.routeId}' is missing and cannot be recreated automatically.`,
        });
      }

      return {
        routeId: route.routeId,
        sandboxInstanceId: route.sandboxInstanceId,
        providerConversationId: route.providerConversationId,
        providerExecutionId:
          inspectedConversation.status === "active"
            ? inspectedConversation.activeExecutionId
            : route.providerExecutionId,
        providerStatus: inspectedConversation.status === "active" ? "active" : "idle",
        resumeRequired: inspectedConversation.status !== "active",
      };
    },
  );
}

async function executeConversationDelivery(
  deps: HandleConversationDeliveryServiceDependencies,
  input: LoadedConversationDeliveryTask,
  boundConversation: PreparedConversationDelivery,
): Promise<{
  providerExecutionId: string | null;
  providerState?: unknown;
}> {
  return withConversationProviderConnection(
    {
      mintSandboxConnectionToken: deps.mintSandboxConnectionToken,
    },
    {
      organizationId: input.automation.organizationId,
      sandboxInstanceId: boundConversation.sandboxInstanceId,
      providerFamily: input.conversation.providerFamily,
    },
    async ({ adapter, connection }) => {
      if (boundConversation.providerStatus === "active") {
        if (adapter.steerExecution === undefined) {
          throw new ConversationProviderError({
            code: ConversationProviderErrorCodes.PROVIDER_STEER_NOT_SUPPORTED,
            message: `Provider '${input.conversation.providerFamily}' does not support steering active executions.`,
          });
        }
        if (boundConversation.providerExecutionId === null) {
          throw new ConversationProviderError({
            code: ConversationProviderErrorCodes.PROVIDER_EXECUTION_MISSING,
            message:
              "Provider reported an active conversation execution but no provider execution id was available.",
          });
        }

        return adapter.steerExecution({
          connection,
          providerConversationId: boundConversation.providerConversationId,
          providerExecutionId: boundConversation.providerExecutionId,
          inputText: input.automationRun.renderedInput ?? "",
        });
      }

      if (boundConversation.resumeRequired) {
        await adapter.resumeConversation({
          connection,
          providerConversationId: boundConversation.providerConversationId,
        });
      }

      return adapter.startExecution({
        connection,
        providerConversationId: boundConversation.providerConversationId,
        inputText: input.automationRun.renderedInput ?? "",
      });
    },
  );
}

async function persistConversationDeliveryExecution(
  db: ControlPlaneDatabase,
  input: {
    boundConversation: PreparedConversationDelivery;
    providerExecutionId: string | null;
    providerState?: unknown;
  },
): Promise<void> {
  await updateConversationExecution(
    {
      db,
    },
    input.providerState === undefined
      ? {
          routeId: input.boundConversation.routeId,
          providerExecutionId: input.providerExecutionId,
        }
      : {
          routeId: input.boundConversation.routeId,
          providerExecutionId: input.providerExecutionId,
          providerState: input.providerState,
        },
  );
}

async function markConversationDeliveryIgnored(
  db: ControlPlaneDatabase,
  input: LoadedConversationDeliveryTask,
): Promise<void> {
  await db.transaction(async (transaction) => {
    await transaction
      .update(conversationDeliveryTasks)
      .set({
        status: ConversationDeliveryTaskStatuses.IGNORED,
        failureCode: null,
        failureMessage: null,
        finishedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(conversationDeliveryTasks.id, input.task.id));

    await transaction
      .update(automationRuns)
      .set({
        status: AutomationRunStatuses.IGNORED,
        failureCode: null,
        failureMessage: null,
        finishedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(automationRuns.id, input.automationRun.id));
  });
}

async function markConversationDeliveryCompleted(
  db: ControlPlaneDatabase,
  input: LoadedConversationDeliveryTask,
): Promise<void> {
  await db.transaction(async (transaction) => {
    await transaction
      .update(conversationDeliveryTasks)
      .set({
        status: ConversationDeliveryTaskStatuses.COMPLETED,
        failureCode: null,
        failureMessage: null,
        finishedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(conversationDeliveryTasks.id, input.task.id));

    await transaction
      .update(automationRuns)
      .set({
        status: AutomationRunStatuses.COMPLETED,
        failureCode: null,
        failureMessage: null,
        finishedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(automationRuns.id, input.automationRun.id));

    await transaction
      .update(conversations)
      .set({
        status: ConversationStatuses.ACTIVE,
        lastProcessedSourceOrderKey: input.task.sourceOrderKey,
        lastProcessedWebhookEventId: input.task.sourceWebhookEventId,
        lastActivityAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(conversations.id, input.conversation.id));
  });
}

async function markConversationDeliveryFailed(
  db: ControlPlaneDatabase,
  input: {
    taskId: string;
    automationRunId: string;
    failureCode: string;
    failureMessage: string;
  },
): Promise<void> {
  await db.transaction(async (transaction) => {
    await transaction
      .update(conversationDeliveryTasks)
      .set({
        status: ConversationDeliveryTaskStatuses.FAILED,
        failureCode: input.failureCode,
        failureMessage: input.failureMessage,
        finishedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(conversationDeliveryTasks.id, input.taskId));

    await transaction
      .update(automationRuns)
      .set({
        status: AutomationRunStatuses.FAILED,
        failureCode: input.failureCode,
        failureMessage: input.failureMessage,
        finishedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(automationRuns.id, input.automationRunId));
  });
}

async function loadConversationDeliveryTaskFailureContext(
  db: ControlPlaneDatabase,
  input: {
    conversationId: string;
    taskId: string;
  },
): Promise<{
  taskId: string;
  automationRunId: string;
} | null> {
  const task = await db.query.conversationDeliveryTasks.findFirst({
    columns: {
      id: true,
      automationRunId: true,
    },
    where: (table, { and: whereAnd, eq }) =>
      whereAnd(eq(table.id, input.taskId), eq(table.conversationId, input.conversationId)),
  });
  if (task === undefined) {
    return null;
  }

  return {
    taskId: task.id,
    automationRunId: task.automationRunId,
  };
}

async function processConversationDeliveryTask(
  deps: HandleConversationDeliveryServiceDependencies,
  input: LoadedConversationDeliveryTask,
): Promise<void> {
  const sandbox = await ensureConversationDeliverySandbox(deps, input);
  const route = await ensureConversationDeliveryRoute(deps.db, input, sandbox);
  const boundConversation = await ensureConversationDeliveryBinding(deps, input, route);
  const executedConversation = await executeConversationDelivery(deps, input, boundConversation);
  await persistConversationDeliveryExecution(deps.db, {
    boundConversation,
    providerExecutionId: executedConversation.providerExecutionId,
    ...(executedConversation.providerState === undefined
      ? {}
      : {
          providerState: executedConversation.providerState,
        }),
  });
}

export async function handleConversationDelivery(
  deps: HandleConversationDeliveryServiceDependencies,
  input: HandleConversationDeliveryWorkflowInput,
): Promise<HandleConversationDeliveryServiceOutput> {
  while (true) {
    const claimedTask = await claimNextConversationDeliveryTask(deps.db, input);
    if (claimedTask.type === "stale") {
      return {
        conversationId: input.conversationId,
        generation: input.generation,
      };
    }

    if (claimedTask.type === "blocked") {
      await releaseConversationDeliveryProcessor(deps.db, input);
      return {
        conversationId: input.conversationId,
        generation: input.generation,
      };
    }

    if (claimedTask.type === "processing-recovery") {
      const failureContext = await loadConversationDeliveryTaskFailureContext(deps.db, {
        conversationId: input.conversationId,
        taskId: claimedTask.taskId,
      });
      if (failureContext !== null) {
        await markConversationDeliveryFailed(deps.db, {
          taskId: failureContext.taskId,
          automationRunId: failureContext.automationRunId,
          failureCode: ConversationDeliveryFailureCodes.CONVERSATION_REQUIRES_MANUAL_RECOVERY,
          failureMessage:
            "Conversation delivery was interrupted after task processing started and requires manual reconciliation before retry.",
        });
      }
      await releaseConversationDeliveryProcessor(deps.db, input);
      return {
        conversationId: input.conversationId,
        generation: input.generation,
      };
    }

    if (claimedTask.type === "empty") {
      const released = await markConversationDeliveryProcessorIdleIfEmpty(deps.db, input);
      if (released) {
        return {
          conversationId: input.conversationId,
          generation: input.generation,
        };
      }

      continue;
    }

    let loadedTask: LoadedConversationDeliveryTask | null = null;
    try {
      loadedTask = await loadConversationDeliveryTask(deps.db, {
        conversationId: input.conversationId,
        taskId: claimedTask.taskId,
      });

      if (
        loadedTask.conversation.lastProcessedSourceOrderKey !== null &&
        loadedTask.task.sourceOrderKey <= loadedTask.conversation.lastProcessedSourceOrderKey
      ) {
        await markConversationDeliveryIgnored(deps.db, loadedTask);
        continue;
      }

      await processConversationDeliveryTask(deps, loadedTask);
      await markConversationDeliveryCompleted(deps.db, loadedTask);
    } catch (error) {
      const failure = resolveConversationDeliveryFailure(error);
      const failureContext =
        loadedTask === null
          ? await loadConversationDeliveryTaskFailureContext(deps.db, {
              conversationId: input.conversationId,
              taskId: claimedTask.taskId,
            })
          : {
              taskId: loadedTask.task.id,
              automationRunId: loadedTask.automationRun.id,
            };
      if (failureContext === null) {
        throw error;
      }

      await markConversationDeliveryFailed(deps.db, {
        taskId: failureContext.taskId,
        automationRunId: failureContext.automationRunId,
        failureCode: failure.code,
        failureMessage: failure.message,
      });
      await releaseConversationDeliveryProcessor(deps.db, input);
      return {
        conversationId: input.conversationId,
        generation: input.generation,
      };
    }
  }
}
