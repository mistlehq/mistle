import type { ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import {
  AutomationRunStatuses,
  type AutomationRunStatus,
  type ControlPlaneDatabase,
  type ControlPlaneTransaction,
  AutomationConversationCreatedByKinds,
  AutomationConversationOwnerKinds,
  IntegrationBindingKinds,
  ScheduleTargetTypes,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";
import { DefaultSandboxWorkspaceDir } from "@mistle/integrations-core";
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
  AUTOMATION_RUN_SOURCE_REFERENCE_MISSING: "automation_run_source_reference_missing",
  WEBHOOK_EVENT_REFERENCE_MISSING: "webhook_event_reference_missing",
  WEBHOOK_EVENT_NOT_FOUND: "webhook_event_not_found",
  WEBHOOK_AUTOMATION_NOT_FOUND: "webhook_automation_not_found",
  SCHEDULE_NOT_FOUND: "schedule_not_found",
  SCHEDULED_ACTION_NOT_FOUND: "scheduled_action_not_found",
  SCHEDULE_AUTOMATION_NOT_FOUND: "schedule_automation_not_found",
  AGENT_BINDING_NOT_FOUND: "agent_binding_not_found",
  AGENT_BINDING_AMBIGUOUS: "agent_binding_ambiguous",
  AGENT_BINDING_CONNECTION_NOT_FOUND: "agent_binding_connection_not_found",
  AGENT_BINDING_TARGET_NOT_FOUND: "agent_binding_target_not_found",
  AGENT_BINDING_RUNTIME_INVALID: "agent_binding_runtime_invalid",
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
  context: Record<string, unknown>;
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
  const renderedInput = renderTemplateString({
    template: input.templates.inputTemplate,
    context: input.context,
  });
  if (renderedInput.trim().length === 0) {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.TEMPLATE_RENDER_FAILED,
      message: "Rendered automation input template must not be empty.",
    });
  }

  const renderedConversationKey = renderTemplateString({
    template: input.templates.conversationKeyTemplate,
    context: input.context,
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
      context: input.context,
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

function hasRuntimeIdValue(input: unknown): input is { runtimeId: string } {
  return (
    typeof input === "object" &&
    input !== null &&
    !Array.isArray(input) &&
    "runtimeId" in input &&
    typeof input.runtimeId === "string"
  );
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
    instructions: string | null;
  };
  automationTarget: {
    id: string;
    sandboxProfileId: string;
    sandboxProfileVersion: number;
    primaryRepositoryId: string | null;
  };
  automation: {
    organizationId: string;
  };
  webhookEvent: {
    id: string;
    integrationConnectionId: string;
    targetKey: string;
    eventType: string;
    providerEventType: string;
    externalEventId: string;
    externalDeliveryId: string | null;
    sourceOrderKey: string | null;
    payload: Record<string, unknown>;
    resolvedUserId: string | null;
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
    primaryRepositoryId: input.automationTarget.primaryRepositoryId,
    workingDirectory: resolveAutomationRunWorkingDirectory({
      primaryRepositoryId: input.automationTarget.primaryRepositoryId,
    }),
    sourceKind: "webhook",
    sourceOrderKey: input.webhookEvent.sourceOrderKey ?? "",
    sourceWebhookEventId: input.webhookEvent.id,
    sourceScheduledActionId: undefined,
    integrationConnectionId: input.webhookEvent.integrationConnectionId,
    targetKey: input.webhookEvent.targetKey,
    webhookEventId: input.webhookEvent.id,
    webhookEventType: input.webhookEvent.eventType,
    webhookProviderEventType: input.webhookEvent.providerEventType,
    webhookExternalEventId: input.webhookEvent.externalEventId,
    webhookExternalDeliveryId: input.webhookEvent.externalDeliveryId,
    webhookPayload: input.webhookEvent.payload,
    scheduledActionId: undefined,
    scheduledAt: undefined,
    localScheduledDate: undefined,
    localScheduledTime: undefined,
    ...(input.webhookEvent.resolvedUserId === null
      ? {}
      : { actingUserId: input.webhookEvent.resolvedUserId }),
    renderedInput: input.automationRun.renderedInput,
    renderedConversationKey: input.automationRun.renderedConversationKey,
    renderedIdempotencyKey: input.automationRun.renderedIdempotencyKey,
    instructions: input.automationRun.instructions,
    collaborationModeSettings: null,
  };
}

function readAgentBindingRuntimeId(input: {
  automationRunId: string;
  bindingId: string;
  bindingConfig: Record<string, unknown>;
}): string {
  const runtime = input.bindingConfig["runtime"];
  if (!hasRuntimeIdValue(runtime) || runtime.runtimeId.trim().length === 0) {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.AGENT_BINDING_RUNTIME_INVALID,
      message: `Automation run '${input.automationRunId}' references AGENT binding '${input.bindingId}' with invalid runtimeId.`,
    });
  }

  return runtime.runtimeId;
}

function resolveAutomationRunWorkingDirectory(input: {
  primaryRepositoryId: string | null;
}): string {
  if (input.primaryRepositoryId === null) {
    return DefaultSandboxWorkspaceDir;
  }

  if (input.primaryRepositoryId.trim().length === 0) {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.AUTOMATION_RUN_EXECUTION_FAILED,
      message: "Automation target primary repository id must not be empty.",
    });
  }

  return `${DefaultSandboxWorkspaceDir}/${input.primaryRepositoryId}`;
}

async function resolveAutomationConversationBindingContext(
  db: ControlPlaneDatabase | ControlPlaneTransaction,
  input: {
    automationRunId: string;
    organizationId: string;
    sandboxProfileId: string;
    sandboxProfileVersion: number;
  },
): Promise<{
  integrationFamilyId: string;
  runtimeId: string;
}> {
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

  const runtimeId = readAgentBindingRuntimeId({
    automationRunId: input.automationRunId,
    bindingId: agentBinding.id,
    bindingConfig: agentBinding.config,
  });

  return {
    integrationFamilyId: agentTarget.familyId,
    runtimeId,
  };
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

  const automationTarget = await ctx.db.query.automationTargets.findFirst({
    where: (table, { eq: whereEq }) => whereEq(table.id, automationTargetId),
  });
  if (automationTarget === undefined) {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.AUTOMATION_TARGET_NOT_FOUND,
      message: `Automation target '${automationRun.automationTargetId}' was not found.`,
    });
  }

  const sandboxProfileVersion = automationTarget.sandboxProfileVersion;
  if (typeof sandboxProfileVersion !== "number") {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.AUTOMATION_RUN_EXECUTION_FAILED,
      message: `Automation target '${automationTarget.id}' does not define a sandbox profile version.`,
    });
  }

  const sourceWebhookEventId = automationRun.sourceWebhookEventId;
  const sourceScheduledActionId = automationRun.sourceScheduledActionId;
  if (
    (sourceWebhookEventId === null && sourceScheduledActionId === null) ||
    (sourceWebhookEventId !== null && sourceScheduledActionId !== null)
  ) {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.AUTOMATION_RUN_SOURCE_REFERENCE_MISSING,
      message: `Automation run '${input.automationRunId}' must reference exactly one automation source.`,
    });
  }

  if (sourceScheduledActionId !== null) {
    return prepareScheduledAutomationRun(ctx, {
      automation,
      automationRun,
      automationTarget,
      sandboxProfileVersion,
      sourceScheduledActionId,
    });
  }
  if (sourceWebhookEventId === null) {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.WEBHOOK_EVENT_REFERENCE_MISSING,
      message: `Automation run '${input.automationRunId}' does not reference a source webhook event.`,
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

  const persistedSnapshot = resolvePersistedPreparedAutomationRunSnapshot({
    automationRun: {
      id: automationRun.id,
      createdAt: automationRun.createdAt,
      automationId: automationRun.automationId,
      conversationId: automationRun.conversationId,
      renderedInput: automationRun.renderedInput,
      renderedConversationKey: automationRun.renderedConversationKey,
      renderedIdempotencyKey: automationRun.renderedIdempotencyKey,
      instructions: automationRun.instructions,
    },
    automationTarget: {
      id: automationTarget.id,
      sandboxProfileId: automationTarget.sandboxProfileId,
      sandboxProfileVersion,
      primaryRepositoryId: automationTarget.primaryRepositoryId,
    },
    automation: {
      organizationId: automation.organizationId,
    },
    webhookEvent: {
      id: webhookEvent.id,
      integrationConnectionId: webhookEvent.integrationConnectionId,
      targetKey: webhookEvent.targetKey,
      eventType: webhookEvent.eventType,
      providerEventType: webhookEvent.providerEventType,
      externalEventId: webhookEvent.externalEventId,
      externalDeliveryId: webhookEvent.externalDeliveryId,
      sourceOrderKey: webhookEvent.sourceOrderKey,
      payload: webhookEvent.payload,
      resolvedUserId: webhookEvent.resolvedUserId,
    },
  });
  if (persistedSnapshot !== null) {
    if (persistedSnapshot.sourceOrderKey.length === 0) {
      throw new AutomationRunExecutionError({
        code: AutomationRunFailureCodes.WEBHOOK_EVENT_SOURCE_ORDER_KEY_MISSING,
        message: `Webhook event '${webhookEvent.id}' is missing source order key.`,
      });
    }

    return {
      ...persistedSnapshot,
      collaborationModeSettings:
        persistedSnapshot.instructions === null
          ? null
          : {
              developerInstructions: persistedSnapshot.instructions,
            },
    };
  }

  const idempotencyKeyTemplate = webhookAutomation.idempotencyKeyTemplate;
  const sourceOrderKey = webhookEvent.sourceOrderKey;
  if (sourceOrderKey === null || sourceOrderKey.trim().length === 0) {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.WEBHOOK_EVENT_SOURCE_ORDER_KEY_MISSING,
      message: `Webhook event '${webhookEvent.id}' is missing source order key.`,
    });
  }

  let compiledTemplates: ReturnType<typeof compileTemplates>;
  try {
    compiledTemplates = compileTemplates({
      context: {
        webhookEvent: {
          id: webhookEvent.id,
          eventType: webhookEvent.eventType,
          providerEventType: webhookEvent.providerEventType,
          externalEventId: webhookEvent.externalEventId,
          externalDeliveryId: webhookEvent.externalDeliveryId,
        },
        automationRun: {
          id: automationRun.id,
          automationId: automationRun.automationId,
          automationTargetId: automationTarget.id,
        },
        payload: webhookEvent.payload,
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

  const bindingContext = await resolveAutomationConversationBindingContext(ctx.db, {
    automationRunId: automationRun.id,
    organizationId: automation.organizationId,
    sandboxProfileId: automationTarget.sandboxProfileId,
    sandboxProfileVersion,
  });

  const claimedConversationId = await ctx.db.transaction(async (tx) => {
    const tables = getControlPlaneDatabaseSchema(tx);

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
        integrationFamilyId: bindingContext.integrationFamilyId,
        runtimeId: bindingContext.runtimeId,
      },
    );

    await tx
      .update(tables.automationRuns)
      .set({
        conversationId: claimedAutomationConversation.id,
        renderedInput: compiledTemplates.renderedInput,
        renderedConversationKey: compiledTemplates.renderedConversationKey,
        renderedIdempotencyKey: compiledTemplates.renderedIdempotencyKey,
        instructions: webhookAutomation.instructions,
        updatedAt: sql`now()`,
      })
      .where(eq(tables.automationRuns.id, automationRun.id));

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
    primaryRepositoryId: automationTarget.primaryRepositoryId,
    workingDirectory: resolveAutomationRunWorkingDirectory({
      primaryRepositoryId: automationTarget.primaryRepositoryId,
    }),
    sourceKind: "webhook",
    sourceOrderKey,
    sourceWebhookEventId: webhookEvent.id,
    sourceScheduledActionId: undefined,
    integrationConnectionId: webhookEvent.integrationConnectionId,
    targetKey: webhookEvent.targetKey,
    webhookEventId: webhookEvent.id,
    webhookEventType: webhookEvent.eventType,
    webhookProviderEventType: webhookEvent.providerEventType,
    webhookExternalEventId: webhookEvent.externalEventId,
    webhookExternalDeliveryId: webhookEvent.externalDeliveryId,
    webhookPayload: webhookEvent.payload,
    scheduledActionId: undefined,
    scheduledAt: undefined,
    localScheduledDate: undefined,
    localScheduledTime: undefined,
    ...(webhookEvent.resolvedUserId === null ? {} : { actingUserId: webhookEvent.resolvedUserId }),
    renderedInput: compiledTemplates.renderedInput,
    renderedConversationKey: compiledTemplates.renderedConversationKey,
    renderedIdempotencyKey: compiledTemplates.renderedIdempotencyKey,
    instructions: webhookAutomation.instructions,
    collaborationModeSettings:
      webhookAutomation.instructions === null
        ? null
        : {
            developerInstructions: webhookAutomation.instructions,
          },
  };
}

async function prepareScheduledAutomationRun(
  ctx: {
    db: ControlPlaneDatabase;
  },
  input: {
    automation: {
      organizationId: string;
    };
    automationRun: {
      id: string;
      createdAt: string;
      automationId: string;
      conversationId: string | null;
      renderedInput: string | null;
      renderedConversationKey: string | null;
      renderedIdempotencyKey: string | null;
      instructions: string | null;
    };
    automationTarget: {
      id: string;
      sandboxProfileId: string;
      sandboxProfileVersion: number;
      primaryRepositoryId: string | null;
    };
    sandboxProfileVersion: number;
    sourceScheduledActionId: string;
  },
): Promise<PreparedAutomationRun> {
  const scheduledAction = await ctx.db.query.scheduledActions.findFirst({
    where: (table, { eq: whereEq }) => whereEq(table.id, input.sourceScheduledActionId),
  });
  if (scheduledAction === undefined) {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.SCHEDULED_ACTION_NOT_FOUND,
      message: `Scheduled action '${input.sourceScheduledActionId}' was not found.`,
    });
  }
  if (scheduledAction.organizationId !== input.automation.organizationId) {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.AUTOMATION_RUN_EXECUTION_FAILED,
      message: `Scheduled action '${scheduledAction.id}' organization does not match automation run '${input.automationRun.id}'.`,
    });
  }

  const schedule = await ctx.db.query.schedules.findFirst({
    where: (table, { eq: whereEq }) => whereEq(table.id, scheduledAction.scheduleId),
  });
  if (schedule === undefined) {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.SCHEDULE_NOT_FOUND,
      message: `Schedule '${scheduledAction.scheduleId}' for scheduled action '${scheduledAction.id}' was not found.`,
    });
  }
  if (schedule.organizationId !== input.automation.organizationId) {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.AUTOMATION_RUN_EXECUTION_FAILED,
      message: `Schedule '${schedule.id}' organization does not match automation run '${input.automationRun.id}'.`,
    });
  }
  if (schedule.targetType !== ScheduleTargetTypes.AUTOMATION_RUN) {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.AUTOMATION_RUN_EXECUTION_FAILED,
      message: `Schedule '${schedule.id}' target type '${schedule.targetType}' does not match automation run '${input.automationRun.id}'.`,
    });
  }

  const scheduleAutomation = await ctx.db.query.scheduleAutomations.findFirst({
    where: (table, { eq: whereEq }) => whereEq(table.scheduleId, scheduledAction.scheduleId),
  });
  if (scheduleAutomation === undefined) {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.SCHEDULE_AUTOMATION_NOT_FOUND,
      message: `Schedule automation target for schedule '${scheduledAction.scheduleId}' was not found.`,
    });
  }
  if (scheduleAutomation.automationId !== input.automationRun.automationId) {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.AUTOMATION_RUN_EXECUTION_FAILED,
      message: `Schedule automation '${scheduleAutomation.automationId}' does not match automation run '${input.automationRun.id}'.`,
    });
  }

  const scheduledAt = normalizeScheduledAt(scheduledAction.scheduledAt, scheduledAction.id);
  const sourceOrderKey = `${scheduledAt}#${scheduledAction.id}`;
  const preparedRunBase = {
    automationRunId: input.automationRun.id,
    automationRunCreatedAt: input.automationRun.createdAt,
    automationId: input.automationRun.automationId,
    automationTargetId: input.automationTarget.id,
    organizationId: input.automation.organizationId,
    sandboxProfileId: input.automationTarget.sandboxProfileId,
    sandboxProfileVersion: input.sandboxProfileVersion,
    primaryRepositoryId: input.automationTarget.primaryRepositoryId,
    workingDirectory: resolveAutomationRunWorkingDirectory({
      primaryRepositoryId: input.automationTarget.primaryRepositoryId,
    }),
    sourceKind: "schedule",
    sourceOrderKey,
    sourceWebhookEventId: undefined,
    sourceScheduledActionId: scheduledAction.id,
    integrationConnectionId: undefined,
    targetKey: undefined,
    webhookEventId: undefined,
    webhookEventType: undefined,
    webhookProviderEventType: undefined,
    webhookExternalEventId: undefined,
    webhookExternalDeliveryId: undefined,
    webhookPayload: undefined,
    scheduledActionId: scheduledAction.id,
    scheduledAt,
    localScheduledDate: scheduledAction.localScheduledDate,
    localScheduledTime: scheduledAction.localScheduledTime,
    instructions: null,
    collaborationModeSettings: null,
  } satisfies Omit<
    PreparedAutomationRun,
    "conversationId" | "renderedInput" | "renderedConversationKey" | "renderedIdempotencyKey"
  >;
  const hasPersistedSnapshot =
    input.automationRun.renderedInput !== null ||
    input.automationRun.renderedConversationKey !== null ||
    input.automationRun.renderedIdempotencyKey !== null;
  if (hasPersistedSnapshot) {
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
      ...preparedRunBase,
      conversationId: input.automationRun.conversationId,
      renderedInput: input.automationRun.renderedInput,
      renderedConversationKey: input.automationRun.renderedConversationKey,
      renderedIdempotencyKey: input.automationRun.renderedIdempotencyKey,
    };
  }

  let compiledTemplates: ReturnType<typeof compileTemplates>;
  try {
    compiledTemplates = compileTemplates({
      context: {
        schedule: {
          id: schedule.id,
          scheduledActionId: scheduledAction.id,
          scheduledAt,
          localScheduledDate: scheduledAction.localScheduledDate,
          localScheduledTime: scheduledAction.localScheduledTime,
          timezone: schedule.timezone,
        },
        automationRun: {
          id: input.automationRun.id,
          automationId: input.automationRun.automationId,
          automationTargetId: input.automationTarget.id,
        },
        payload: {},
      },
      templates: {
        inputTemplate: scheduleAutomation.inputTemplate,
        conversationKeyTemplate: scheduleAutomation.conversationKeyTemplate,
        idempotencyKeyTemplate: scheduleAutomation.idempotencyKeyTemplate,
      },
    });
  } catch (error) {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.TEMPLATE_RENDER_FAILED,
      message: error instanceof Error ? error.message : "Template rendering failed.",
      cause: error,
    });
  }

  const bindingContext = await resolveAutomationConversationBindingContext(ctx.db, {
    automationRunId: input.automationRun.id,
    organizationId: input.automation.organizationId,
    sandboxProfileId: input.automationTarget.sandboxProfileId,
    sandboxProfileVersion: input.sandboxProfileVersion,
  });

  const claimedConversationId = await ctx.db.transaction(async (tx) => {
    const tables = getControlPlaneDatabaseSchema(tx);

    const claimedAutomationConversation = await claimAutomationConversation(
      {
        db: tx,
      },
      {
        organizationId: input.automation.organizationId,
        ownerKind: AutomationConversationOwnerKinds.AUTOMATION_TARGET,
        ownerId: input.automationTarget.id,
        createdByKind: AutomationConversationCreatedByKinds.SCHEDULE,
        createdById: scheduledAction.id,
        conversationKey: compiledTemplates.renderedConversationKey,
        sandboxProfileId: input.automationTarget.sandboxProfileId,
        integrationFamilyId: bindingContext.integrationFamilyId,
        runtimeId: bindingContext.runtimeId,
      },
    );

    await tx
      .update(tables.automationRuns)
      .set({
        conversationId: claimedAutomationConversation.id,
        renderedInput: compiledTemplates.renderedInput,
        renderedConversationKey: compiledTemplates.renderedConversationKey,
        renderedIdempotencyKey: compiledTemplates.renderedIdempotencyKey,
        instructions: null,
        updatedAt: sql`now()`,
      })
      .where(eq(tables.automationRuns.id, input.automationRun.id));

    return claimedAutomationConversation.id;
  });

  return {
    ...preparedRunBase,
    conversationId: claimedConversationId,
    renderedInput: compiledTemplates.renderedInput,
    renderedConversationKey: compiledTemplates.renderedConversationKey,
    renderedIdempotencyKey: compiledTemplates.renderedIdempotencyKey,
  };
}

function normalizeScheduledAt(scheduledAt: string, scheduledActionId: string): string {
  const timestamp = new Date(scheduledAt);
  if (Number.isNaN(timestamp.getTime())) {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.AUTOMATION_RUN_EXECUTION_FAILED,
      message: `Scheduled action '${scheduledActionId}' has invalid scheduled_at '${scheduledAt}'.`,
    });
  }

  return timestamp.toISOString();
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
    primaryRepositoryId: input.preparedAutomationRun.primaryRepositoryId,
    startedBy: {
      kind: "system",
      id: input.preparedAutomationRun.automationRunId,
    },
    source: input.preparedAutomationRun.sourceKind,
    ...(input.preparedAutomationRun.actingUserId === undefined
      ? {}
      : {
          actingUser: {
            userId: input.preparedAutomationRun.actingUserId,
          },
        }),
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
  const tables = getControlPlaneDatabaseSchema(ctx.db);

  await ctx.db
    .update(tables.automationRuns)
    .set({
      status: input.status,
      failureCode: input.failureCode,
      failureMessage: input.failureMessage,
      finishedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(tables.automationRuns.id, input.automationRunId),
        eq(tables.automationRuns.status, AutomationRunStatuses.RUNNING),
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
