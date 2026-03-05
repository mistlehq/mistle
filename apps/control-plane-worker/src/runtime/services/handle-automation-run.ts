import { renderTemplateString } from "@mistle/automations";
import {
  automationRuns,
  AutomationRunStatuses,
  type AutomationRunStatus,
  type ControlPlaneDatabase,
} from "@mistle/db/control-plane";
import type { HandleAutomationRunWorkflowInput } from "@mistle/workflows/control-plane";
import { and, eq, sql } from "drizzle-orm";

import {
  connectSandboxAgentConnection,
  sendSandboxAgentMessage,
} from "./sandbox-agent-connection.js";
import type {
  AcquireAutomationConnectionServiceOutput,
  AcquireAutomationConnectionServiceInput,
  DeliverAutomationPayloadServiceInput,
  EnsureAutomationSandboxServiceOutput,
  EnsureAutomationSandboxServiceInput,
  PrepareAutomationRunServiceOutput,
} from "./types.js";

export type HandleAutomationRunDependencies = {
  db: ControlPlaneDatabase;
};

export type EnsureAutomationSandboxDependencies = {
  db: ControlPlaneDatabase;
  startSandboxProfileInstance: (input: {
    organizationId: string;
    profileId: string;
    profileVersion: number;
    startedBy: {
      kind: "user" | "system";
      id: string;
    };
    source: "dashboard" | "webhook";
  }) => Promise<{
    workflowRunId: string;
    sandboxInstanceId: string;
    providerSandboxId: string;
  }>;
};

export type AcquireAutomationConnectionDependencies = {
  mintSandboxConnectionToken: (input: { organizationId: string; instanceId: string }) => Promise<{
    instanceId: string;
    url: string;
    token: string;
    expiresAt: string;
  }>;
};

export type TransitionAutomationRunToRunningOutput = {
  shouldProcess: boolean;
};

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
  AUTOMATION_TARGET_NOT_FOUND: "automation_target_not_found",
  WEBHOOK_EVENT_REFERENCE_MISSING: "webhook_event_reference_missing",
  WEBHOOK_EVENT_NOT_FOUND: "webhook_event_not_found",
  WEBHOOK_AUTOMATION_NOT_FOUND: "webhook_automation_not_found",
  TEMPLATE_RENDER_FAILED: "template_render_failed",
  AUTOMATION_RUN_EXECUTION_FAILED: "automation_run_execution_failed",
} as const;

type AutomationWebhookDeliveryEnvelope = {
  webhookEvent: {
    id: string;
    eventType: string;
    providerEventType: string;
    externalEventId: string;
    externalDeliveryId: string | null;
  };
  automationRun: {
    id: string;
    automationId: string;
    automationTargetId: string;
    createdAt: string;
    conversationKey: string;
    idempotencyKey: string | null;
    input: string;
  };
  payload: Record<string, unknown>;
};

class AutomationRunExecutionError extends Error {
  readonly code: string;

  constructor(input: { code: string; message: string; cause?: unknown }) {
    super(input.message, {
      cause: input.cause,
    });
    this.code = input.code;
  }
}

export function resolveAutomationRunFailure(input: unknown): { code: string; message: string } {
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

export async function transitionAutomationRunToRunning(
  deps: HandleAutomationRunDependencies,
  input: HandleAutomationRunWorkflowInput,
): Promise<TransitionAutomationRunToRunningOutput> {
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
    renderedIdempotencyKey = renderTemplateString({
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

  return {
    renderedInput,
    renderedConversationKey,
    renderedIdempotencyKey,
  };
}

export async function prepareAutomationRun(
  deps: HandleAutomationRunDependencies,
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

  const sandboxProfileVersion = automationTarget.sandboxProfileVersion;
  if (sandboxProfileVersion === null) {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.AUTOMATION_RUN_EXECUTION_FAILED,
      message: `Automation target '${automationTarget.id}' does not define a sandbox profile version.`,
    });
  }

  return {
    automationRunId: automationRun.id,
    automationRunCreatedAt: automationRun.createdAt,
    automationId: automationRun.automationId,
    automationTargetId: automationTarget.id,
    organizationId: automation.organizationId,
    sandboxProfileId: automationTarget.sandboxProfileId,
    sandboxProfileVersion,
    webhookEventId: webhookEvent.id,
    webhookEventType: webhookEvent.eventType,
    webhookProviderEventType: webhookEvent.providerEventType,
    webhookExternalEventId: webhookEvent.externalEventId,
    webhookExternalDeliveryId: webhookEvent.externalDeliveryId,
    webhookPayload: webhookEvent.payload,
    renderedInput: compiledTemplates.renderedInput,
    renderedConversationKey: compiledTemplates.renderedConversationKey,
    renderedIdempotencyKey: compiledTemplates.renderedIdempotencyKey,
  };
}

export async function ensureAutomationSandbox(
  deps: EnsureAutomationSandboxDependencies,
  input: EnsureAutomationSandboxServiceInput,
): Promise<EnsureAutomationSandboxServiceOutput> {
  const automationRun = await deps.db.query.automationRuns.findFirst({
    where: (table, { eq: whereEq }) =>
      whereEq(table.id, input.preparedAutomationRun.automationRunId),
  });
  if (automationRun === undefined) {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.AUTOMATION_RUN_NOT_FOUND,
      message: `Automation run '${input.preparedAutomationRun.automationRunId}' was not found.`,
    });
  }

  if (automationRun.status !== AutomationRunStatuses.RUNNING) {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.AUTOMATION_RUN_EXECUTION_FAILED,
      message: `Automation run '${automationRun.id}' is not running while ensuring sandbox.`,
    });
  }

  const startedSandbox = await deps.startSandboxProfileInstance({
    organizationId: input.preparedAutomationRun.organizationId,
    profileId: input.preparedAutomationRun.sandboxProfileId,
    profileVersion: input.preparedAutomationRun.sandboxProfileVersion,
    startedBy: {
      kind: "system",
      id: input.preparedAutomationRun.automationRunId,
    },
    source: "webhook",
  });

  return {
    sandboxInstanceId: startedSandbox.sandboxInstanceId,
    providerSandboxId: startedSandbox.providerSandboxId,
    startupWorkflowRunId: startedSandbox.workflowRunId,
  };
}

export async function acquireAutomationConnection(
  deps: AcquireAutomationConnectionDependencies,
  input: AcquireAutomationConnectionServiceInput,
): Promise<AcquireAutomationConnectionServiceOutput> {
  if (input.preparedAutomationRun.renderedConversationKey.trim().length === 0) {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.TEMPLATE_RENDER_FAILED,
      message: "Rendered automation conversation key template must not be empty.",
    });
  }

  const connection = await deps.mintSandboxConnectionToken({
    organizationId: input.preparedAutomationRun.organizationId,
    instanceId: input.ensuredAutomationSandbox.sandboxInstanceId,
  });

  return {
    instanceId: connection.instanceId,
    url: connection.url,
    token: connection.token,
    expiresAt: connection.expiresAt,
  };
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

  const outboundPayload: AutomationWebhookDeliveryEnvelope = {
    webhookEvent: {
      id: input.preparedAutomationRun.webhookEventId,
      eventType: input.preparedAutomationRun.webhookEventType,
      providerEventType: input.preparedAutomationRun.webhookProviderEventType,
      externalEventId: input.preparedAutomationRun.webhookExternalEventId,
      externalDeliveryId: input.preparedAutomationRun.webhookExternalDeliveryId,
    },
    automationRun: {
      id: input.preparedAutomationRun.automationRunId,
      automationId: input.preparedAutomationRun.automationId,
      automationTargetId: input.preparedAutomationRun.automationTargetId,
      createdAt: input.preparedAutomationRun.automationRunCreatedAt,
      conversationKey: input.preparedAutomationRun.renderedConversationKey,
      idempotencyKey: input.preparedAutomationRun.renderedIdempotencyKey,
      input: input.preparedAutomationRun.renderedInput,
    },
    payload: input.preparedAutomationRun.webhookPayload,
  };

  try {
    const connection = await connectSandboxAgentConnection({
      connectionUrl: input.acquiredAutomationConnection.url,
    });
    await sendSandboxAgentMessage({
      connection,
      message: JSON.stringify(outboundPayload),
    });
  } catch (error) {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.AUTOMATION_RUN_EXECUTION_FAILED,
      message: error instanceof Error ? error.message : "Failed to deliver automation payload.",
      cause: error,
    });
  }
}

export async function markAutomationRunCompleted(
  deps: HandleAutomationRunDependencies,
  input: HandleAutomationRunWorkflowInput,
): Promise<void> {
  const updatedRows = await deps.db
    .update(automationRuns)
    .set({
      status: AutomationRunStatuses.COMPLETED,
      failureCode: null,
      failureMessage: null,
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

  if (existingRun.status === AutomationRunStatuses.COMPLETED) {
    return;
  }

  throw new AutomationRunExecutionError({
    code: AutomationRunFailureCodes.AUTOMATION_RUN_EXECUTION_FAILED,
    message: `Automation run '${input.automationRunId}' could not be marked completed from status '${existingRun.status}'.`,
  });
}

export async function markAutomationRunFailed(
  deps: HandleAutomationRunDependencies,
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
