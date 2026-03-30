import type { ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import {
  automationRuns,
  AutomationRunStatuses,
  type AutomationRunStatus,
  type ControlPlaneDatabase,
  type ControlPlaneTransaction,
  AutomationConversationCreatedByKinds,
  AutomationConversationOwnerKinds,
  IntegrationBindingKinds,
} from "@mistle/db/control-plane";
import { and, eq, sql } from "drizzle-orm";

import type {
  EnsuredAutomationSandbox,
  MarkAutomationRunFailedInput,
  PrepareAutomationRunInput,
  PreparedAutomationRun,
} from "./automation-run-types.js";
import { claimAutomationConversation } from "./claim-conversation.js";
import { renderTemplateString } from "./render-template-string.js";

type AutomationRunIdInput = {
  automationRunId: string;
};

type UpdateAutomationRunTerminalStateInput = {
  automationRunId: string;
  status: AutomationRunStatus;
  failureCode: string | null;
  failureMessage: string | null;
};

export type EnsureAutomationSandboxDependencies = {
  db: ControlPlaneDatabase;
  controlPlaneInternalClient: Pick<ControlPlaneInternalClient, "startSandboxProfileInstance">;
};

export const AutomationRunFailureCodes = {
  AUTOMATION_RUN_NOT_FOUND: "automation_run_not_found",
  AUTOMATION_NOT_FOUND: "automation_not_found",
  AUTOMATION_TARGET_REFERENCE_MISSING: "automation_target_reference_missing",
  AUTOMATION_TARGET_NOT_FOUND: "automation_target_not_found",
  WEBHOOK_EVENT_REFERENCE_MISSING: "webhook_event_reference_missing",
  WEBHOOK_EVENT_NOT_FOUND: "webhook_event_not_found",
  WEBHOOK_AUTOMATION_NOT_FOUND: "webhook_automation_not_found",
  AGENT_BINDING_NOT_FOUND: "agent_binding_not_found",
  AGENT_BINDING_AMBIGUOUS: "agent_binding_ambiguous",
  AGENT_BINDING_CONNECTION_NOT_FOUND: "agent_binding_connection_not_found",
  AGENT_BINDING_TARGET_NOT_FOUND: "agent_binding_target_not_found",
  WEBHOOK_EVENT_SOURCE_ORDER_KEY_MISSING: "webhook_event_source_order_key_missing",
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

export function createAutomationRunExecutionError(input: {
  code: string;
  message: string;
  cause?: unknown;
}) {
  return new AutomationRunExecutionError(input);
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

function resolvePersistedPreparedAutomationRunSnapshot(input: {
  automationRun: {
    id: string;
    createdAt: string;
    automationId: string;
    conversationId: string | null;
    renderedInput: string | null;
    renderedConversationKey: string | null;
    renderedIdempotencyKey: string | null;
  };
  automationTarget: {
    id: string;
    sandboxProfileId: string;
    sandboxProfileVersion: number;
  };
  automation: {
    organizationId: string;
  };
  webhookEvent: {
    id: string;
    eventType: string;
    providerEventType: string;
    externalEventId: string;
    externalDeliveryId: string | null;
    sourceOrderKey: string | null;
    payload: Record<string, unknown>;
  };
}): PreparedAutomationRun | null {
  const hasPersistedSnapshot =
    input.automationRun.renderedInput !== null ||
    input.automationRun.renderedConversationKey !== null ||
    input.automationRun.renderedIdempotencyKey !== null;

  if (!hasPersistedSnapshot) {
    return null;
  }

  if (
    input.automationRun.conversationId === null ||
    input.automationRun.renderedInput === null ||
    input.automationRun.renderedConversationKey === null
  ) {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.AUTOMATION_RUN_EXECUTION_FAILED,
      message: `Automation run '${input.automationRun.id}' is missing persisted prepared state.`,
    });
  }

  return {
    automationRunId: input.automationRun.id,
    automationRunCreatedAt: input.automationRun.createdAt,
    automationId: input.automationRun.automationId,
    conversationId: input.automationRun.conversationId,
    automationTargetId: input.automationTarget.id,
    organizationId: input.automation.organizationId,
    sandboxProfileId: input.automationTarget.sandboxProfileId,
    sandboxProfileVersion: input.automationTarget.sandboxProfileVersion,
    webhookEventId: input.webhookEvent.id,
    webhookEventType: input.webhookEvent.eventType,
    webhookProviderEventType: input.webhookEvent.providerEventType,
    webhookExternalEventId: input.webhookEvent.externalEventId,
    webhookExternalDeliveryId: input.webhookEvent.externalDeliveryId,
    webhookSourceOrderKey: input.webhookEvent.sourceOrderKey ?? "",
    webhookPayload: input.webhookEvent.payload,
    renderedInput: input.automationRun.renderedInput,
    renderedConversationKey: input.automationRun.renderedConversationKey,
    renderedIdempotencyKey: input.automationRun.renderedIdempotencyKey,
  };
}

async function resolveAutomationConversationIntegrationFamilyId(
  db: ControlPlaneDatabase | ControlPlaneTransaction,
  input: {
    automationRunId: string;
    organizationId: string;
    sandboxProfileId: string;
    sandboxProfileVersion: number;
  },
): Promise<string> {
  const agentBindings = await db.query.sandboxProfileVersionIntegrationBindings.findMany({
    where: (table, { and: whereAnd, eq: whereEq }) =>
      whereAnd(
        whereEq(table.sandboxProfileId, input.sandboxProfileId),
        whereEq(table.sandboxProfileVersion, input.sandboxProfileVersion),
        whereEq(table.kind, IntegrationBindingKinds.AGENT),
      ),
    orderBy: (table, { asc }) => [asc(table.id)],
  });

  const agentBinding = agentBindings[0];
  if (agentBinding === undefined) {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.AGENT_BINDING_NOT_FOUND,
      message: `Automation run '${input.automationRunId}' requires exactly one AGENT binding on sandbox profile '${input.sandboxProfileId}' version '${input.sandboxProfileVersion}', but none were found.`,
    });
  }
  if (agentBindings[1] !== undefined) {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.AGENT_BINDING_AMBIGUOUS,
      message: `Automation run '${input.automationRunId}' requires exactly one AGENT binding on sandbox profile '${input.sandboxProfileId}' version '${input.sandboxProfileVersion}', but multiple were found.`,
    });
  }

  const agentConnection = await db.query.integrationConnections.findFirst({
    where: (table, { and: whereAnd, eq: whereEq }) =>
      whereAnd(
        whereEq(table.id, agentBinding.connectionId),
        whereEq(table.organizationId, input.organizationId),
      ),
  });
  if (agentConnection === undefined) {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.AGENT_BINDING_CONNECTION_NOT_FOUND,
      message: `Automation run '${input.automationRunId}' references AGENT binding '${agentBinding.id}' with connection '${agentBinding.connectionId}' that is missing or inaccessible.`,
    });
  }

  const agentTarget = await db.query.integrationTargets.findFirst({
    where: (table, { eq: whereEq }) => whereEq(table.targetKey, agentConnection.targetKey),
  });
  if (agentTarget === undefined) {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.AGENT_BINDING_TARGET_NOT_FOUND,
      message: `Automation run '${input.automationRunId}' references AGENT connection '${agentConnection.id}' with target '${agentConnection.targetKey}' that does not exist.`,
    });
  }

  return agentTarget.familyId;
}

export async function prepareAutomationRun(
  ctx: {
    db: ControlPlaneDatabase;
  },
  input: PrepareAutomationRunInput,
): Promise<PreparedAutomationRun> {
  const automationRun = await ctx.db.query.automationRuns.findFirst({
    where: (table, { eq: whereEq }) => whereEq(table.id, input.automationRunId),
  });
  if (automationRun === undefined) {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.AUTOMATION_RUN_NOT_FOUND,
      message: `Automation run '${input.automationRunId}' was not found.`,
    });
  }

  const automation = await ctx.db.query.automations.findFirst({
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

  const automationTarget = await ctx.db.query.automationTargets.findFirst({
    where: (table, { eq: whereEq }) => whereEq(table.id, automationTargetId),
  });
  if (automationTarget === undefined) {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.AUTOMATION_TARGET_NOT_FOUND,
      message: `Automation target '${automationRun.automationTargetId}' was not found.`,
    });
  }

  const webhookAutomation = await ctx.db.query.webhookAutomations.findFirst({
    where: (table, { eq: whereEq }) => whereEq(table.automationId, automationRun.automationId),
  });
  if (webhookAutomation === undefined) {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.WEBHOOK_AUTOMATION_NOT_FOUND,
      message: `Webhook automation for automation '${automationRun.automationId}' was not found.`,
    });
  }

  const webhookEvent = await ctx.db.query.integrationWebhookEvents.findFirst({
    where: (table, { eq: whereEq }) => whereEq(table.id, sourceWebhookEventId),
  });
  if (webhookEvent === undefined) {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.WEBHOOK_EVENT_NOT_FOUND,
      message: `Webhook event '${sourceWebhookEventId}' was not found.`,
    });
  }

  const sandboxProfileVersion = automationTarget.sandboxProfileVersion;
  if (typeof sandboxProfileVersion !== "number") {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.AUTOMATION_RUN_EXECUTION_FAILED,
      message: `Automation target '${automationTarget.id}' does not define a sandbox profile version.`,
    });
  }

  const persistedSnapshot = resolvePersistedPreparedAutomationRunSnapshot({
    automationRun: {
      id: automationRun.id,
      createdAt: automationRun.createdAt,
      automationId: automationRun.automationId,
      conversationId: automationRun.conversationId,
      renderedInput: automationRun.renderedInput,
      renderedConversationKey: automationRun.renderedConversationKey,
      renderedIdempotencyKey: automationRun.renderedIdempotencyKey,
    },
    automationTarget: {
      id: automationTarget.id,
      sandboxProfileId: automationTarget.sandboxProfileId,
      sandboxProfileVersion,
    },
    automation: {
      organizationId: automation.organizationId,
    },
    webhookEvent: {
      id: webhookEvent.id,
      eventType: webhookEvent.eventType,
      providerEventType: webhookEvent.providerEventType,
      externalEventId: webhookEvent.externalEventId,
      externalDeliveryId: webhookEvent.externalDeliveryId,
      sourceOrderKey: webhookEvent.sourceOrderKey,
      payload: webhookEvent.payload,
    },
  });
  if (persistedSnapshot !== null) {
    if (persistedSnapshot.webhookSourceOrderKey.length === 0) {
      throw new AutomationRunExecutionError({
        code: AutomationRunFailureCodes.WEBHOOK_EVENT_SOURCE_ORDER_KEY_MISSING,
        message: `Webhook event '${webhookEvent.id}' is missing source order key.`,
      });
    }

    return persistedSnapshot;
  }

  const idempotencyKeyTemplate = webhookAutomation.idempotencyKeyTemplate;
  const webhookSourceOrderKey = webhookEvent.sourceOrderKey;
  if (webhookSourceOrderKey === null || webhookSourceOrderKey.trim().length === 0) {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.WEBHOOK_EVENT_SOURCE_ORDER_KEY_MISSING,
      message: `Webhook event '${webhookEvent.id}' is missing source order key.`,
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

  const claimedConversationId = await ctx.db.transaction(async (tx) => {
    const integrationFamilyId = await resolveAutomationConversationIntegrationFamilyId(tx, {
      automationRunId: automationRun.id,
      organizationId: automation.organizationId,
      sandboxProfileId: automationTarget.sandboxProfileId,
      sandboxProfileVersion,
    });

    const claimedAutomationConversation = await claimAutomationConversation(
      {
        db: tx,
      },
      {
        organizationId: automation.organizationId,
        ownerKind: AutomationConversationOwnerKinds.AUTOMATION_TARGET,
        ownerId: automationTarget.id,
        createdByKind: AutomationConversationCreatedByKinds.WEBHOOK,
        createdById: webhookEvent.id,
        conversationKey: compiledTemplates.renderedConversationKey,
        sandboxProfileId: automationTarget.sandboxProfileId,
        integrationFamilyId,
        preview: compiledTemplates.renderedInput,
      },
    );

    await tx
      .update(automationRuns)
      .set({
        conversationId: claimedAutomationConversation.id,
        renderedInput: compiledTemplates.renderedInput,
        renderedConversationKey: compiledTemplates.renderedConversationKey,
        renderedIdempotencyKey: compiledTemplates.renderedIdempotencyKey,
        updatedAt: sql`now()`,
      })
      .where(eq(automationRuns.id, automationRun.id));

    return claimedAutomationConversation.id;
  });

  return {
    automationRunId: automationRun.id,
    automationRunCreatedAt: automationRun.createdAt,
    automationId: automationRun.automationId,
    conversationId: claimedConversationId,
    automationTargetId: automationTarget.id,
    organizationId: automation.organizationId,
    sandboxProfileId: automationTarget.sandboxProfileId,
    sandboxProfileVersion,
    webhookEventId: webhookEvent.id,
    webhookEventType: webhookEvent.eventType,
    webhookProviderEventType: webhookEvent.providerEventType,
    webhookExternalEventId: webhookEvent.externalEventId,
    webhookExternalDeliveryId: webhookEvent.externalDeliveryId,
    webhookSourceOrderKey,
    webhookPayload: webhookEvent.payload,
    renderedInput: compiledTemplates.renderedInput,
    renderedConversationKey: compiledTemplates.renderedConversationKey,
    renderedIdempotencyKey: compiledTemplates.renderedIdempotencyKey,
  };
}

export async function ensureAutomationSandbox(
  ctx: EnsureAutomationSandboxDependencies,
  input: {
    preparedAutomationRun: PreparedAutomationRun;
  },
): Promise<EnsuredAutomationSandbox> {
  const automationRun = await ctx.db.query.automationRuns.findFirst({
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

  const startedSandbox = await ctx.controlPlaneInternalClient.startSandboxProfileInstance({
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

async function updateAutomationRunTerminalState(
  ctx: {
    db: ControlPlaneDatabase;
  },
  input: UpdateAutomationRunTerminalStateInput,
): Promise<void> {
  await ctx.db
    .update(automationRuns)
    .set({
      status: input.status,
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
    );
}

export async function markAutomationRunCompleted(
  ctx: {
    db: ControlPlaneDatabase;
  },
  input: AutomationRunIdInput,
): Promise<void> {
  await updateAutomationRunTerminalState(ctx, {
    automationRunId: input.automationRunId,
    status: AutomationRunStatuses.COMPLETED,
    failureCode: null,
    failureMessage: null,
  });
}

export async function markAutomationRunFailed(
  ctx: {
    db: ControlPlaneDatabase;
  },
  input: MarkAutomationRunFailedInput,
): Promise<void> {
  await updateAutomationRunTerminalState(ctx, {
    automationRunId: input.automationRunId,
    status: AutomationRunStatuses.FAILED,
    failureCode: input.failureCode,
    failureMessage: input.failureMessage,
  });
}

export async function markAutomationRunIgnored(
  ctx: {
    db: ControlPlaneDatabase;
  },
  input: AutomationRunIdInput,
): Promise<void> {
  await updateAutomationRunTerminalState(ctx, {
    automationRunId: input.automationRunId,
    status: AutomationRunStatuses.IGNORED,
    failureCode: null,
    failureMessage: null,
  });
}
