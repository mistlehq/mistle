import { renderTemplateString } from "@mistle/automations";
import {
  automationRuns,
  AutomationRunStatuses,
  conversationDeliveryProcessors,
  ConversationDeliveryProcessorStatuses,
  conversationDeliveryTasks,
  ConversationDeliveryTaskStatuses,
  ConversationCreatedByKinds,
  ConversationOwnerKinds,
  type AutomationRunStatus,
  type ControlPlaneDatabase,
} from "@mistle/db/control-plane";
import {
  HandleConversationDeliveryWorkflowSpec,
  type HandleAutomationRunWorkflowInput,
} from "@mistle/workflows/control-plane";
import { and, eq, sql } from "drizzle-orm";

import { claimConversation } from "../conversations/index.js";
import {
  AutomationTargetDeliveryConfigError,
  loadAutomationTargetDeliveryConfig,
} from "./load-automation-target-delivery-config.js";
import {
  connectSandboxAgentConnection,
  sendSandboxAgentMessage,
} from "./sandbox-agent-connection.js";
import type {
  DeliverAutomationPayloadServiceInput,
  EnqueuePreparedAutomationRunServiceInput,
  HandleAutomationRunServiceDependencies,
  HandleAutomationRunTransitionServiceOutput,
  PrepareAutomationRunServiceOutput,
} from "./types.js";

export type MarkAutomationRunFailedInput = {
  automationRunId: string;
  failureCode: string;
  failureMessage: string;
};

const TerminalAutomationRunStatuses = new Set<AutomationRunStatus>([
  AutomationRunStatuses.COMPLETED,
  AutomationRunStatuses.FAILED,
  AutomationRunStatuses.IGNORED,
  AutomationRunStatuses.DUPLICATE,
]);

const AutomationRunFailureCodes = {
  AUTOMATION_RUN_NOT_FOUND: "automation_run_not_found",
  AUTOMATION_NOT_FOUND: "automation_not_found",
  AUTOMATION_TARGET_REFERENCE_MISSING: "automation_target_reference_missing",
  WEBHOOK_EVENT_REFERENCE_MISSING: "webhook_event_reference_missing",
  WEBHOOK_EVENT_NOT_FOUND: "webhook_event_not_found",
  WEBHOOK_EVENT_SOURCE_ORDER_KEY_MISSING: "webhook_event_source_order_key_missing",
  WEBHOOK_AUTOMATION_NOT_FOUND: "webhook_automation_not_found",
  TEMPLATE_RENDER_FAILED: "template_render_failed",
  AUTOMATION_RUN_EXECUTION_FAILED: "automation_run_execution_failed",
} as const;

class AutomationRunExecutionError extends Error {
  readonly code: string;

  constructor(input: { code: string; message: string; cause?: unknown }) {
    super(input.message, {
      cause: input.cause,
    });
    this.code = input.code;
  }
}

function buildPreparedAutomationRunFromPersistedState(input: {
  automationRun: typeof automationRuns.$inferSelect;
  existingTask: typeof conversationDeliveryTasks.$inferSelect;
  automation: {
    organizationId: string;
  };
  conversation: {
    id: string;
    ownerId: string;
    sandboxProfileId: string;
    providerFamily: PrepareAutomationRunServiceOutput["providerFamily"];
  };
  webhookEvent: {
    id: string;
    eventType: string;
    providerEventType: string;
    externalEventId: string;
    externalDeliveryId: string | null;
    payload: Record<string, unknown>;
    sourceOccurredAt: string | null;
    sourceOrderKey: string | null;
  };
}): PrepareAutomationRunServiceOutput {
  if (
    input.automationRun.renderedInput === null ||
    input.automationRun.renderedConversationKey === null
  ) {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.TEMPLATE_RENDER_FAILED,
      message: `Automation run '${input.automationRun.id}' does not have frozen rendered delivery state.`,
    });
  }

  if (
    input.webhookEvent.sourceOrderKey === null ||
    input.webhookEvent.sourceOrderKey.trim().length === 0
  ) {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.WEBHOOK_EVENT_SOURCE_ORDER_KEY_MISSING,
      message: `Webhook event '${input.webhookEvent.id}' does not define a source order key.`,
    });
  }

  return {
    automationRunId: input.automationRun.id,
    automationRunCreatedAt: input.automationRun.createdAt,
    automationId: input.automationRun.automationId,
    automationTargetId: input.conversation.ownerId,
    organizationId: input.automation.organizationId,
    sandboxProfileId: input.conversation.sandboxProfileId,
    webhookEventId: input.webhookEvent.id,
    webhookEventType: input.webhookEvent.eventType,
    webhookProviderEventType: input.webhookEvent.providerEventType,
    webhookExternalEventId: input.webhookEvent.externalEventId,
    webhookExternalDeliveryId: input.webhookEvent.externalDeliveryId,
    webhookPayload: input.webhookEvent.payload,
    sourceOccurredAt: input.webhookEvent.sourceOccurredAt,
    sourceOrderKey: input.webhookEvent.sourceOrderKey,
    providerFamily: input.conversation.providerFamily,
    renderedInput: input.automationRun.renderedInput,
    renderedConversationKey: input.automationRun.renderedConversationKey,
    renderedIdempotencyKey: input.automationRun.renderedIdempotencyKey,
  };
}

function compileTemplates(input: {
  webhookEvent: {
    id: string;
    eventType: string;
    providerEventType: string;
    externalEventId: string;
    externalDeliveryId: string | null;
    payload: Record<string, unknown>;
  };
  automationRun: {
    id: string;
    automationId: string;
    automationTargetId: string;
  };
  templates: {
    inputTemplate: string;
    conversationKeyTemplate: string;
    idempotencyKeyTemplate: string | null;
  };
}): {
  renderedInput: string;
  renderedConversationKey: string;
  renderedIdempotencyKey: string | null;
} {
  const templateContext: Record<string, unknown> = {
    webhookEvent: {
      id: input.webhookEvent.id,
      eventType: input.webhookEvent.eventType,
      providerEventType: input.webhookEvent.providerEventType,
      externalEventId: input.webhookEvent.externalEventId,
      externalDeliveryId: input.webhookEvent.externalDeliveryId,
    },
    automationRun: {
      id: input.automationRun.id,
      automationId: input.automationRun.automationId,
      automationTargetId: input.automationRun.automationTargetId,
    },
    payload: input.webhookEvent.payload,
  };

  const renderedInput = renderTemplateString({
    template: input.templates.inputTemplate,
    context: templateContext,
  });
  if (renderedInput.trim().length === 0) {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.TEMPLATE_RENDER_FAILED,
      message: "Rendered automation input template must not be empty.",
    });
  }

  const renderedConversationKey = renderTemplateString({
    template: input.templates.conversationKeyTemplate,
    context: templateContext,
  });
  if (renderedConversationKey.trim().length === 0) {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.TEMPLATE_RENDER_FAILED,
      message: "Rendered automation conversation key template must not be empty.",
    });
  }

  let renderedIdempotencyKey: string | null = null;
  if (input.templates.idempotencyKeyTemplate !== null) {
    const compiledIdempotencyKey = renderTemplateString({
      template: input.templates.idempotencyKeyTemplate,
      context: templateContext,
    });
    if (compiledIdempotencyKey.trim().length === 0) {
      throw new AutomationRunExecutionError({
        code: AutomationRunFailureCodes.TEMPLATE_RENDER_FAILED,
        message: "Rendered automation idempotency key template must not be empty.",
      });
    }
    renderedIdempotencyKey = compiledIdempotencyKey;
  }

  return {
    renderedInput,
    renderedConversationKey,
    renderedIdempotencyKey,
  };
}

export function resolveAutomationRunFailure(input: unknown): { code: string; message: string } {
  if (input instanceof AutomationRunExecutionError) {
    return {
      code: input.code,
      message: input.message,
    };
  }

  if (input instanceof AutomationTargetDeliveryConfigError) {
    return {
      code: input.code,
      message: input.message,
    };
  }

  if (input instanceof Error) {
    return {
      code: AutomationRunFailureCodes.AUTOMATION_RUN_EXECUTION_FAILED,
      message: input.message,
    };
  }

  return {
    code: AutomationRunFailureCodes.AUTOMATION_RUN_EXECUTION_FAILED,
    message: "Automation run execution failed with a non-error exception.",
  };
}

export async function transitionAutomationRunToRunning(
  deps: HandleAutomationRunServiceDependencies,
  input: HandleAutomationRunWorkflowInput,
): Promise<HandleAutomationRunTransitionServiceOutput> {
  const transitionedRows = await deps.db
    .update(automationRuns)
    .set({
      status: AutomationRunStatuses.RUNNING,
      startedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(automationRuns.id, input.automationRunId),
        eq(automationRuns.status, AutomationRunStatuses.QUEUED),
      ),
    )
    .returning();

  const transitionedRun = transitionedRows[0];
  if (transitionedRun !== undefined) {
    return {
      shouldProcess: true,
    };
  }

  const existingRun = await deps.db.query.automationRuns.findFirst({
    where: (table, { eq: whereEq }) => whereEq(table.id, input.automationRunId),
  });
  if (existingRun === undefined) {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.AUTOMATION_RUN_NOT_FOUND,
      message: `Automation run '${input.automationRunId}' was not found.`,
    });
  }

  if (TerminalAutomationRunStatuses.has(existingRun.status)) {
    return {
      shouldProcess: false,
    };
  }

  if (existingRun.status === AutomationRunStatuses.RUNNING) {
    return {
      shouldProcess: true,
    };
  }

  throw new AutomationRunExecutionError({
    code: AutomationRunFailureCodes.AUTOMATION_RUN_EXECUTION_FAILED,
    message: `Automation run '${input.automationRunId}' is in unsupported status '${existingRun.status}'.`,
  });
}

export async function prepareAutomationRun(
  deps: HandleAutomationRunServiceDependencies,
  input: HandleAutomationRunWorkflowInput,
): Promise<PrepareAutomationRunServiceOutput> {
  const automationRun = await deps.db.query.automationRuns.findFirst({
    where: (table, { eq: whereEq }) => whereEq(table.id, input.automationRunId),
  });
  if (automationRun === undefined) {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.AUTOMATION_RUN_NOT_FOUND,
      message: `Automation run '${input.automationRunId}' was not found.`,
    });
  }

  const automation = await deps.db.query.automations.findFirst({
    where: (table, { eq: whereEq }) => whereEq(table.id, automationRun.automationId),
  });
  if (automation === undefined) {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.AUTOMATION_NOT_FOUND,
      message: `Automation '${automationRun.automationId}' was not found.`,
    });
  }

  const sourceWebhookEventId = automationRun.sourceWebhookEventId;
  if (sourceWebhookEventId === null) {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.WEBHOOK_EVENT_REFERENCE_MISSING,
      message: `Automation run '${input.automationRunId}' does not reference a source webhook event.`,
    });
  }

  const webhookEvent = await deps.db.query.integrationWebhookEvents.findFirst({
    where: (table, { eq: whereEq }) => whereEq(table.id, sourceWebhookEventId),
  });
  if (webhookEvent === undefined) {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.WEBHOOK_EVENT_NOT_FOUND,
      message: `Webhook event '${sourceWebhookEventId}' was not found.`,
    });
  }

  const existingTask = await deps.db.query.conversationDeliveryTasks.findFirst({
    where: (table, { eq: whereEq }) => whereEq(table.automationRunId, automationRun.id),
  });
  if (existingTask !== undefined) {
    const conversation = await deps.db.query.conversations.findFirst({
      columns: {
        id: true,
        ownerId: true,
        sandboxProfileId: true,
        providerFamily: true,
      },
      where: (table, { eq: whereEq }) => whereEq(table.id, existingTask.conversationId),
    });
    if (conversation === undefined) {
      throw new AutomationRunExecutionError({
        code: AutomationRunFailureCodes.AUTOMATION_RUN_EXECUTION_FAILED,
        message: `Conversation '${existingTask.conversationId}' for automation run '${automationRun.id}' was not found.`,
      });
    }

    return buildPreparedAutomationRunFromPersistedState({
      automationRun,
      existingTask,
      automation,
      conversation,
      webhookEvent: {
        id: webhookEvent.id,
        eventType: webhookEvent.eventType,
        providerEventType: webhookEvent.providerEventType,
        externalEventId: webhookEvent.externalEventId,
        externalDeliveryId: webhookEvent.externalDeliveryId,
        payload: webhookEvent.payload,
        sourceOccurredAt: webhookEvent.sourceOccurredAt,
        sourceOrderKey: webhookEvent.sourceOrderKey,
      },
    });
  }

  const automationTargetId = automationRun.automationTargetId;
  if (automationTargetId === null) {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.AUTOMATION_TARGET_REFERENCE_MISSING,
      message: `Automation run '${input.automationRunId}' does not reference an automation target.`,
    });
  }

  const webhookAutomation = await deps.db.query.webhookAutomations.findFirst({
    where: (table, { eq: whereEq }) => whereEq(table.automationId, automationRun.automationId),
  });
  if (webhookAutomation === undefined) {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.WEBHOOK_AUTOMATION_NOT_FOUND,
      message: `Webhook automation for automation '${automationRun.automationId}' was not found.`,
    });
  }

  if (webhookEvent.sourceOrderKey === null || webhookEvent.sourceOrderKey.trim().length === 0) {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.WEBHOOK_EVENT_SOURCE_ORDER_KEY_MISSING,
      message: `Webhook event '${webhookEvent.id}' does not define a source order key.`,
    });
  }

  let compiledTemplates: ReturnType<typeof compileTemplates>;
  try {
    compiledTemplates = compileTemplates({
      webhookEvent: {
        id: webhookEvent.id,
        eventType: webhookEvent.eventType,
        providerEventType: webhookEvent.providerEventType,
        externalEventId: webhookEvent.externalEventId,
        externalDeliveryId: webhookEvent.externalDeliveryId,
        payload: webhookEvent.payload,
      },
      automationRun: {
        id: automationRun.id,
        automationId: automationRun.automationId,
        automationTargetId,
      },
      templates: {
        inputTemplate: webhookAutomation.inputTemplate,
        conversationKeyTemplate: webhookAutomation.conversationKeyTemplate,
        idempotencyKeyTemplate: webhookAutomation.idempotencyKeyTemplate,
      },
    });
  } catch (error) {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.TEMPLATE_RENDER_FAILED,
      message: error instanceof Error ? error.message : "Template rendering failed.",
      cause: error,
    });
  }

  const deliveryConfig = await loadAutomationTargetDeliveryConfig(deps.db, {
    automationTargetId,
  });

  return {
    automationRunId: automationRun.id,
    automationRunCreatedAt: automationRun.createdAt,
    automationId: automationRun.automationId,
    automationTargetId,
    organizationId: automation.organizationId,
    sandboxProfileId: deliveryConfig.sandboxProfileId,
    webhookEventId: webhookEvent.id,
    webhookEventType: webhookEvent.eventType,
    webhookProviderEventType: webhookEvent.providerEventType,
    webhookExternalEventId: webhookEvent.externalEventId,
    webhookExternalDeliveryId: webhookEvent.externalDeliveryId,
    webhookPayload: webhookEvent.payload,
    sourceOccurredAt: webhookEvent.sourceOccurredAt,
    sourceOrderKey: webhookEvent.sourceOrderKey,
    providerFamily: deliveryConfig.providerFamily,
    renderedInput: compiledTemplates.renderedInput,
    renderedConversationKey: compiledTemplates.renderedConversationKey,
    renderedIdempotencyKey: compiledTemplates.renderedIdempotencyKey,
  };
}

async function ensureExistingQueuedTask(input: {
  db: ControlPlaneDatabase;
  automationRunId: string;
  conversationId: string;
  webhookEventId: string;
  sourceOrderKey: string;
}): Promise<void> {
  const existingTask = await input.db.query.conversationDeliveryTasks.findFirst({
    where: (table, { eq: whereEq }) => whereEq(table.automationRunId, input.automationRunId),
  });
  if (existingTask === undefined) {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.AUTOMATION_RUN_EXECUTION_FAILED,
      message:
        "Conversation delivery task insert conflict occurred but no existing task record could be loaded.",
    });
  }

  if (
    existingTask.conversationId !== input.conversationId ||
    existingTask.sourceWebhookEventId !== input.webhookEventId ||
    existingTask.sourceOrderKey !== input.sourceOrderKey
  ) {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.AUTOMATION_RUN_EXECUTION_FAILED,
      message: `Conversation delivery task for automation run '${input.automationRunId}' does not match the prepared webhook delivery state.`,
    });
  }
}

async function startConversationDeliveryProcessor(input: {
  deps: HandleAutomationRunServiceDependencies;
  conversationId: string;
}): Promise<void> {
  if (input.deps.openWorkflow === undefined) {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.AUTOMATION_RUN_EXECUTION_FAILED,
      message: "OpenWorkflow client is required to start conversation delivery processors.",
    });
  }

  const claimedProcessor = await input.deps.db.transaction(async (transaction) => {
    const [processor] = await transaction
      .select({
        generation: conversationDeliveryProcessors.generation,
        status: conversationDeliveryProcessors.status,
      })
      .from(conversationDeliveryProcessors)
      .where(eq(conversationDeliveryProcessors.conversationId, input.conversationId))
      .for("update");
    if (processor === undefined) {
      throw new AutomationRunExecutionError({
        code: AutomationRunFailureCodes.AUTOMATION_RUN_EXECUTION_FAILED,
        message: `Conversation delivery processor for conversation '${input.conversationId}' was not found.`,
      });
    }
    if (processor.status !== ConversationDeliveryProcessorStatuses.IDLE) {
      return null;
    }

    const updatedRows = await transaction
      .update(conversationDeliveryProcessors)
      .set({
        status: ConversationDeliveryProcessorStatuses.RUNNING,
        generation: processor.generation + 1,
        activeWorkflowRunId: null,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(conversationDeliveryProcessors.conversationId, input.conversationId),
          eq(conversationDeliveryProcessors.generation, processor.generation),
          eq(conversationDeliveryProcessors.status, ConversationDeliveryProcessorStatuses.IDLE),
        ),
      )
      .returning({
        generation: conversationDeliveryProcessors.generation,
      });

    const updatedProcessor = updatedRows[0];
    if (updatedProcessor === undefined) {
      return null;
    }

    return {
      generation: updatedProcessor.generation,
    };
  });

  if (claimedProcessor === null) {
    return;
  }

  try {
    const workflowHandle = await input.deps.openWorkflow.runWorkflow(
      HandleConversationDeliveryWorkflowSpec,
      {
        conversationId: input.conversationId,
        generation: claimedProcessor.generation,
      },
      {
        idempotencyKey: `${input.conversationId}:${String(claimedProcessor.generation)}`,
      },
    );

    await input.deps.db
      .update(conversationDeliveryProcessors)
      .set({
        activeWorkflowRunId: workflowHandle.workflowRun.id,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(conversationDeliveryProcessors.conversationId, input.conversationId),
          eq(conversationDeliveryProcessors.generation, claimedProcessor.generation),
          eq(conversationDeliveryProcessors.status, ConversationDeliveryProcessorStatuses.RUNNING),
        ),
      );
  } catch (error) {
    await input.deps.db
      .update(conversationDeliveryProcessors)
      .set({
        status: ConversationDeliveryProcessorStatuses.IDLE,
        activeWorkflowRunId: null,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(conversationDeliveryProcessors.conversationId, input.conversationId),
          eq(conversationDeliveryProcessors.generation, claimedProcessor.generation),
          eq(conversationDeliveryProcessors.status, ConversationDeliveryProcessorStatuses.RUNNING),
        ),
      );
    throw error;
  }
}

export async function enqueuePreparedAutomationRun(
  deps: HandleAutomationRunServiceDependencies,
  input: EnqueuePreparedAutomationRunServiceInput,
): Promise<void> {
  const existingTask = await deps.db.query.conversationDeliveryTasks.findFirst({
    where: (table, { eq: whereEq }) =>
      whereEq(table.automationRunId, input.preparedAutomationRun.automationRunId),
  });

  let conversationId: string;
  if (existingTask === undefined) {
    const conversation = await claimConversation(
      {
        db: deps.db,
      },
      {
        organizationId: input.preparedAutomationRun.organizationId,
        ownerKind: ConversationOwnerKinds.AUTOMATION_TARGET,
        ownerId: input.preparedAutomationRun.automationTargetId,
        createdByKind: ConversationCreatedByKinds.WEBHOOK,
        createdById: input.preparedAutomationRun.webhookEventId,
        conversationKey: input.preparedAutomationRun.renderedConversationKey,
        sandboxProfileId: input.preparedAutomationRun.sandboxProfileId,
        providerFamily: input.preparedAutomationRun.providerFamily,
        title: null,
        preview: input.preparedAutomationRun.renderedInput,
      },
    );
    conversationId = conversation.id;

    await deps.db.transaction(async (transaction) => {
      const updatedRunRows = await transaction
        .update(automationRuns)
        .set({
          conversationId,
          renderedInput: input.preparedAutomationRun.renderedInput,
          renderedConversationKey: input.preparedAutomationRun.renderedConversationKey,
          renderedIdempotencyKey: input.preparedAutomationRun.renderedIdempotencyKey,
          updatedAt: sql`now()`,
        })
        .where(eq(automationRuns.id, input.preparedAutomationRun.automationRunId))
        .returning({
          id: automationRuns.id,
        });
      if (updatedRunRows[0] === undefined) {
        throw new AutomationRunExecutionError({
          code: AutomationRunFailureCodes.AUTOMATION_RUN_NOT_FOUND,
          message: `Automation run '${input.preparedAutomationRun.automationRunId}' was not found during enqueue.`,
        });
      }

      const insertedTaskRows = await transaction
        .insert(conversationDeliveryTasks)
        .values({
          conversationId,
          automationRunId: input.preparedAutomationRun.automationRunId,
          sourceWebhookEventId: input.preparedAutomationRun.webhookEventId,
          sourceOrderKey: input.preparedAutomationRun.sourceOrderKey,
          status: ConversationDeliveryTaskStatuses.QUEUED,
        })
        .onConflictDoNothing({
          target: [conversationDeliveryTasks.automationRunId],
        })
        .returning({
          id: conversationDeliveryTasks.id,
        });

      if (insertedTaskRows[0] === undefined) {
        await ensureExistingQueuedTask({
          db: deps.db,
          automationRunId: input.preparedAutomationRun.automationRunId,
          conversationId,
          webhookEventId: input.preparedAutomationRun.webhookEventId,
          sourceOrderKey: input.preparedAutomationRun.sourceOrderKey,
        });
      }

      await transaction
        .insert(conversationDeliveryProcessors)
        .values({
          conversationId,
          generation: 0,
          status: ConversationDeliveryProcessorStatuses.IDLE,
          activeWorkflowRunId: null,
        })
        .onConflictDoNothing({
          target: [conversationDeliveryProcessors.conversationId],
        });
    });
  } else {
    conversationId = existingTask.conversationId;
    const existingRun = await deps.db.query.automationRuns.findFirst({
      where: (table, { eq: whereEq }) =>
        whereEq(table.id, input.preparedAutomationRun.automationRunId),
    });
    if (
      existingRun === undefined ||
      existingRun.conversationId !== conversationId ||
      existingRun.renderedInput !== input.preparedAutomationRun.renderedInput ||
      existingRun.renderedConversationKey !== input.preparedAutomationRun.renderedConversationKey ||
      existingRun.renderedIdempotencyKey !== input.preparedAutomationRun.renderedIdempotencyKey
    ) {
      throw new AutomationRunExecutionError({
        code: AutomationRunFailureCodes.AUTOMATION_RUN_NOT_FOUND,
        message: `Automation run '${input.preparedAutomationRun.automationRunId}' does not match the existing conversation delivery task state.`,
      });
    }

    await ensureExistingQueuedTask({
      db: deps.db,
      automationRunId: input.preparedAutomationRun.automationRunId,
      conversationId,
      webhookEventId: input.preparedAutomationRun.webhookEventId,
      sourceOrderKey: input.preparedAutomationRun.sourceOrderKey,
    });
  }

  await startConversationDeliveryProcessor({
    deps,
    conversationId,
  });
}

export async function deliverAutomationPayload(
  input: DeliverAutomationPayloadServiceInput,
): Promise<void> {
  if (input.preparedAutomationRun.renderedInput.trim().length === 0) {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.TEMPLATE_RENDER_FAILED,
      message: "Rendered automation input template must not be empty.",
    });
  }

  if (input.acquiredAutomationConnection.token.trim().length === 0) {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.AUTOMATION_RUN_EXECUTION_FAILED,
      message: "Acquired automation connection token must not be empty.",
    });
  }

  if (input.acquiredAutomationConnection.url.trim().length === 0) {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.AUTOMATION_RUN_EXECUTION_FAILED,
      message: "Acquired automation connection URL must not be empty.",
    });
  }

  try {
    const connection = await connectSandboxAgentConnection({
      connectionUrl: input.acquiredAutomationConnection.url,
    });
    await sendSandboxAgentMessage({
      connection,
      message: input.preparedAutomationRun.renderedInput,
    });
  } catch (error) {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.AUTOMATION_RUN_EXECUTION_FAILED,
      message: error instanceof Error ? error.message : "Failed to deliver automation payload.",
      cause: error,
    });
  }
}

export async function markAutomationRunFailed(
  deps: HandleAutomationRunServiceDependencies,
  input: MarkAutomationRunFailedInput,
): Promise<void> {
  const updatedRows = await deps.db
    .update(automationRuns)
    .set({
      status: AutomationRunStatuses.FAILED,
      failureCode: input.failureCode,
      failureMessage: input.failureMessage,
      finishedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(automationRuns.id, input.automationRunId),
        eq(automationRuns.status, AutomationRunStatuses.RUNNING),
      ),
    )
    .returning({
      id: automationRuns.id,
    });
  if (updatedRows.length > 0) {
    return;
  }

  const existingRun = await deps.db.query.automationRuns.findFirst({
    where: (table, { eq: whereEq }) => whereEq(table.id, input.automationRunId),
  });
  if (existingRun === undefined) {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.AUTOMATION_RUN_NOT_FOUND,
      message: `Automation run '${input.automationRunId}' was not found.`,
    });
  }

  if (
    existingRun.status === AutomationRunStatuses.FAILED &&
    existingRun.failureCode === input.failureCode &&
    existingRun.failureMessage === input.failureMessage
  ) {
    return;
  }

  throw new AutomationRunExecutionError({
    code: AutomationRunFailureCodes.AUTOMATION_RUN_EXECUTION_FAILED,
    message: `Automation run '${input.automationRunId}' could not be marked failed from status '${existingRun.status}'.`,
  });
}
