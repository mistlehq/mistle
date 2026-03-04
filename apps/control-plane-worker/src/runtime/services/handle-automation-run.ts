import { renderTemplateString } from "@mistle/automations";
import {
  automationRuns,
  AutomationRunStatuses,
  type AutomationRunStatus,
  type ControlPlaneDatabase,
} from "@mistle/db/control-plane";
import type {
  HandleAutomationRunWorkflowInput,
  HandleAutomationRunWorkflowOutput,
} from "@mistle/workflows/control-plane";
import { and, eq, sql } from "drizzle-orm";

type HandleAutomationRunDependencies = {
  db: ControlPlaneDatabase;
};

const TerminalAutomationRunStatuses = new Set<AutomationRunStatus>([
  AutomationRunStatuses.COMPLETED,
  AutomationRunStatuses.FAILED,
  AutomationRunStatuses.IGNORED,
  AutomationRunStatuses.DUPLICATE,
]);

const AutomationRunFailureCodes = {
  AUTOMATION_RUN_NOT_FOUND: "automation_run_not_found",
  AUTOMATION_TARGET_REFERENCE_MISSING: "automation_target_reference_missing",
  AUTOMATION_TARGET_NOT_FOUND: "automation_target_not_found",
  WEBHOOK_EVENT_REFERENCE_MISSING: "webhook_event_reference_missing",
  WEBHOOK_EVENT_NOT_FOUND: "webhook_event_not_found",
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

function resolveAutomationRunFailure(input: unknown): { code: string; message: string } {
  if (input instanceof AutomationRunExecutionError) {
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

async function markAutomationRunCompleted(input: {
  db: ControlPlaneDatabase;
  automationRunId: string;
}): Promise<void> {
  await input.db
    .update(automationRuns)
    .set({
      status: AutomationRunStatuses.COMPLETED,
      failureCode: null,
      failureMessage: null,
      finishedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(eq(automationRuns.id, input.automationRunId));
}

async function markAutomationRunFailed(input: {
  db: ControlPlaneDatabase;
  automationRunId: string;
  failureCode: string;
  failureMessage: string;
}): Promise<void> {
  await input.db
    .update(automationRuns)
    .set({
      status: AutomationRunStatuses.FAILED,
      failureCode: input.failureCode,
      failureMessage: input.failureMessage,
      finishedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(eq(automationRuns.id, input.automationRunId));
}

async function transitionAutomationRunToRunning(input: {
  db: ControlPlaneDatabase;
  automationRunId: string;
}) {
  const transitionedRows = await input.db
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
    return transitionedRun;
  }

  const existingRun = await input.db.query.automationRuns.findFirst({
    where: (table, { eq: whereEq }) => whereEq(table.id, input.automationRunId),
  });
  if (existingRun === undefined) {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.AUTOMATION_RUN_NOT_FOUND,
      message: `Automation run '${input.automationRunId}' was not found.`,
    });
  }

  if (
    TerminalAutomationRunStatuses.has(existingRun.status) ||
    existingRun.status === AutomationRunStatuses.RUNNING
  ) {
    return null;
  }

  throw new AutomationRunExecutionError({
    code: AutomationRunFailureCodes.AUTOMATION_RUN_EXECUTION_FAILED,
    message: `Automation run '${input.automationRunId}' is in unsupported status '${existingRun.status}'.`,
  });
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
}): void {
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

  if (input.templates.idempotencyKeyTemplate !== null) {
    const renderedIdempotencyKey = renderTemplateString({
      template: input.templates.idempotencyKeyTemplate,
      context: templateContext,
    });
    if (renderedIdempotencyKey.trim().length === 0) {
      throw new AutomationRunExecutionError({
        code: AutomationRunFailureCodes.TEMPLATE_RENDER_FAILED,
        message: "Rendered automation idempotency key template must not be empty.",
      });
    }
  }
}

export async function handleAutomationRun(
  deps: HandleAutomationRunDependencies,
  input: HandleAutomationRunWorkflowInput,
): Promise<HandleAutomationRunWorkflowOutput> {
  const automationRun = await transitionAutomationRunToRunning({
    db: deps.db,
    automationRunId: input.automationRunId,
  });
  if (automationRun === null) {
    return {
      automationRunId: input.automationRunId,
    };
  }

  try {
    const automationTargetId = automationRun.automationTargetId;
    if (automationTargetId === null) {
      throw new AutomationRunExecutionError({
        code: AutomationRunFailureCodes.AUTOMATION_TARGET_REFERENCE_MISSING,
        message: `Automation run '${input.automationRunId}' does not reference an automation target.`,
      });
    }

    const sourceWebhookEventId = automationRun.sourceWebhookEventId;
    if (sourceWebhookEventId === null) {
      throw new AutomationRunExecutionError({
        code: AutomationRunFailureCodes.WEBHOOK_EVENT_REFERENCE_MISSING,
        message: `Automation run '${input.automationRunId}' does not reference a source webhook event.`,
      });
    }

    const automationTarget = await deps.db.query.automationTargets.findFirst({
      where: (table, { eq: whereEq }) => whereEq(table.id, automationTargetId),
    });
    if (automationTarget === undefined) {
      throw new AutomationRunExecutionError({
        code: AutomationRunFailureCodes.AUTOMATION_TARGET_NOT_FOUND,
        message: `Automation target '${automationRun.automationTargetId}' was not found.`,
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

    const webhookEvent = await deps.db.query.integrationWebhookEvents.findFirst({
      where: (table, { eq: whereEq }) => whereEq(table.id, sourceWebhookEventId),
    });
    if (webhookEvent === undefined) {
      throw new AutomationRunExecutionError({
        code: AutomationRunFailureCodes.WEBHOOK_EVENT_NOT_FOUND,
        message: `Webhook event '${sourceWebhookEventId}' was not found.`,
      });
    }

    const idempotencyKeyTemplate = webhookAutomation.idempotencyKeyTemplate;

    try {
      compileTemplates({
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
          automationTargetId: automationTarget.id,
        },
        templates: {
          inputTemplate: webhookAutomation.inputTemplate,
          conversationKeyTemplate: webhookAutomation.conversationKeyTemplate,
          idempotencyKeyTemplate,
        },
      });
    } catch (error) {
      throw new AutomationRunExecutionError({
        code: AutomationRunFailureCodes.TEMPLATE_RENDER_FAILED,
        message: error instanceof Error ? error.message : "Template rendering failed.",
        cause: error,
      });
    }

    await markAutomationRunCompleted({
      db: deps.db,
      automationRunId: input.automationRunId,
    });
  } catch (error) {
    const failure = resolveAutomationRunFailure(error);
    await markAutomationRunFailed({
      db: deps.db,
      automationRunId: input.automationRunId,
      failureCode: failure.code,
      failureMessage: failure.message,
    });

    throw error;
  }

  return {
    automationRunId: input.automationRunId,
  };
}
