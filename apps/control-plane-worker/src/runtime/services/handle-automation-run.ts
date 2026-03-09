import { renderTemplateString } from "@mistle/automations";
import {
  automationRuns,
  AutomationRunStatuses,
  ConversationCreatedByKinds,
  ConversationOwnerKinds,
  ConversationProviderFamilies,
  IntegrationBindingKinds,
  type AutomationRunStatus,
  type ControlPlaneDatabase,
} from "@mistle/db/control-plane";
import { systemSleeper } from "@mistle/time";
import type { HandleAutomationRunWorkflowInput } from "@mistle/workflows/control-plane";
import { and, eq, sql } from "drizzle-orm";

import { claimConversation } from "../conversations/index.js";
import {
  connectSandboxAgentConnection,
  sendSandboxAgentMessage,
} from "./sandbox-agent-connection.js";
import type {
  AcquireAutomationConnectionServiceOutput,
  AcquireAutomationConnectionServiceInput,
  ClaimAutomationConversationServiceInput,
  ClaimAutomationConversationServiceOutput,
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
  }>;
};

export type AcquireAutomationConnectionDependencies = {
  getSandboxInstance: (input: { organizationId: string; instanceId: string }) => Promise<{
    id: string;
    status: "starting" | "running" | "stopped" | "failed";
    failureCode: string | null;
    failureMessage: string | null;
  }>;
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
const SandboxStartTimeoutMs = 5 * 60 * 1000;
const SandboxStartPollIntervalMs = 1_000;

const AutomationRunFailureCodes = {
  AUTOMATION_RUN_NOT_FOUND: "automation_run_not_found",
  AUTOMATION_NOT_FOUND: "automation_not_found",
  AUTOMATION_TARGET_REFERENCE_MISSING: "automation_target_reference_missing",
  AUTOMATION_TARGET_NOT_FOUND: "automation_target_not_found",
  AUTOMATION_TARGET_BINDING_MISSING: "automation_target_binding_missing",
  AUTOMATION_TARGET_BINDING_AMBIGUOUS: "automation_target_binding_ambiguous",
  AUTOMATION_TARGET_BINDING_INVALID: "automation_target_binding_invalid",
  AUTOMATION_TARGET_PROVIDER_UNSUPPORTED: "automation_target_provider_unsupported",
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

async function loadAutomationTargetProviderFamily(
  db: ControlPlaneDatabase,
  input: {
    automationTargetId: string;
    sandboxProfileId: string;
    sandboxProfileVersion: number;
  },
) {
  const agentBindings = await db.query.sandboxProfileVersionIntegrationBindings.findMany({
    where: (table, { and: whereAnd, eq: whereEq }) =>
      whereAnd(
        whereEq(table.sandboxProfileId, input.sandboxProfileId),
        whereEq(table.sandboxProfileVersion, input.sandboxProfileVersion),
        whereEq(table.kind, IntegrationBindingKinds.AGENT),
      ),
  });
  if (agentBindings.length === 0) {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.AUTOMATION_TARGET_BINDING_MISSING,
      message: `Automation target '${input.automationTargetId}' does not have an agent integration binding for sandbox profile '${input.sandboxProfileId}' version '${String(input.sandboxProfileVersion)}'.`,
    });
  }
  if (agentBindings.length > 1) {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.AUTOMATION_TARGET_BINDING_AMBIGUOUS,
      message: `Automation target '${input.automationTargetId}' has multiple agent integration bindings for sandbox profile '${input.sandboxProfileId}' version '${String(input.sandboxProfileVersion)}'.`,
    });
  }

  const agentBinding = agentBindings[0];
  if (agentBinding === undefined) {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.AUTOMATION_TARGET_BINDING_MISSING,
      message: "Expected an agent integration binding but none was available.",
    });
  }

  const connection = await db.query.integrationConnections.findFirst({
    columns: {
      id: true,
      targetKey: true,
    },
    where: (table, { eq: whereEq }) => whereEq(table.id, agentBinding.connectionId),
  });
  if (connection === undefined) {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.AUTOMATION_TARGET_BINDING_INVALID,
      message: `Agent integration binding '${agentBinding.id}' references missing connection '${agentBinding.connectionId}'.`,
    });
  }

  const target = await db.query.integrationTargets.findFirst({
    columns: {
      targetKey: true,
      familyId: true,
    },
    where: (table, { eq: whereEq }) => whereEq(table.targetKey, connection.targetKey),
  });
  if (target === undefined) {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.AUTOMATION_TARGET_BINDING_INVALID,
      message: `Agent connection '${connection.id}' references missing target '${connection.targetKey}'.`,
    });
  }

  switch (target.familyId) {
    case "openai":
      return ConversationProviderFamilies.CODEX;
    default:
      throw new AutomationRunExecutionError({
        code: AutomationRunFailureCodes.AUTOMATION_TARGET_PROVIDER_UNSUPPORTED,
        message: `Automation target '${input.automationTargetId}' uses unsupported provider family '${target.familyId}' for conversations.`,
      });
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

export async function claimAutomationConversation(
  deps: HandleAutomationRunDependencies,
  input: ClaimAutomationConversationServiceInput,
): Promise<ClaimAutomationConversationServiceOutput> {
  const providerFamily = await loadAutomationTargetProviderFamily(deps.db, {
    automationTargetId: input.preparedAutomationRun.automationTargetId,
    sandboxProfileId: input.preparedAutomationRun.sandboxProfileId,
    sandboxProfileVersion: input.preparedAutomationRun.sandboxProfileVersion,
  });

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
      providerFamily,
      title: null,
      preview: input.preparedAutomationRun.renderedInput,
    },
  );

  await deps.db
    .update(automationRuns)
    .set({
      conversationId: conversation.id,
      renderedInput: input.preparedAutomationRun.renderedInput,
      renderedConversationKey: input.preparedAutomationRun.renderedConversationKey,
      renderedIdempotencyKey: input.preparedAutomationRun.renderedIdempotencyKey,
      updatedAt: sql`now()`,
    })
    .where(eq(automationRuns.id, input.preparedAutomationRun.automationRunId));

  return {
    conversationId: conversation.id,
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

  const deadline = Date.now() + SandboxStartTimeoutMs;
  let isSandboxRunning = false;
  while (Date.now() < deadline) {
    const sandboxInstance = await deps.getSandboxInstance({
      organizationId: input.preparedAutomationRun.organizationId,
      instanceId: input.ensuredAutomationSandbox.sandboxInstanceId,
    });

    if (sandboxInstance.status === "running") {
      isSandboxRunning = true;
      break;
    }

    if (sandboxInstance.status === "failed" || sandboxInstance.status === "stopped") {
      throw new AutomationRunExecutionError({
        code: AutomationRunFailureCodes.AUTOMATION_RUN_EXECUTION_FAILED,
        message:
          sandboxInstance.failureMessage ??
          `Sandbox instance '${sandboxInstance.id}' entered terminal status '${sandboxInstance.status}' before it became ready.`,
      });
    }

    await systemSleeper.sleep(SandboxStartPollIntervalMs);
  }

  if (!isSandboxRunning) {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.AUTOMATION_RUN_EXECUTION_FAILED,
      message: `Sandbox instance '${input.ensuredAutomationSandbox.sandboxInstanceId}' did not become ready before the automation timeout elapsed.`,
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
