import type { ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import {
  TriggerRunStatuses,
  type TriggerRunStatus,
  type ControlPlaneDatabase,
  type ControlPlaneTransaction,
  TriggerConversationCreatedByKinds,
  TriggerConversationOwnerKinds,
  IntegrationBindingKinds,
  ScheduleTargetTypes,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";
import { DefaultSandboxWorkspaceDir } from "@mistle/integrations-core";
import {
  agentDefinitionAllowsRuntime,
  createAgentProviderKey,
  createDefinitionsBundle,
  resolvePrimaryConversationIntegrationFamilyId,
} from "@mistle/integrations-definitions/server";
import { and, eq, sql } from "drizzle-orm";

import { claimTriggerConversation } from "./claim-conversation.js";
import { renderTemplateString } from "./render-template-string.js";
import type {
  EnsuredTriggerSandbox,
  MarkTriggerRunFailedInput,
  PrepareTriggerRunInput,
  PreparedTriggerRun,
} from "./trigger-run-types.js";

const Definitions = createDefinitionsBundle();
const IntegrationRegistry = Definitions.integrationRegistry;

type TriggerRunIdInput = {
  triggerRunId: string;
};

type UpdateTriggerRunTerminalStateInput = {
  triggerRunId: string;
  status: TriggerRunStatus;
  failureCode: string | null;
  failureMessage: string | null;
};

export type EnsureTriggerSandboxDependencies = {
  db: ControlPlaneDatabase;
  controlPlaneInternalClient: Pick<ControlPlaneInternalClient, "startSandboxProfileInstance">;
};

export const TriggerRunFailureCodes = {
  TRIGGER_RUN_NOT_FOUND: "trigger_run_not_found",
  TRIGGER_NOT_FOUND: "trigger_not_found",
  TRIGGER_TARGET_REFERENCE_MISSING: "trigger_target_reference_missing",
  TRIGGER_TARGET_NOT_FOUND: "trigger_target_not_found",
  TRIGGER_RUN_SOURCE_REFERENCE_MISSING: "trigger_run_source_reference_missing",
  WEBHOOK_EVENT_REFERENCE_MISSING: "webhook_event_reference_missing",
  WEBHOOK_EVENT_NOT_FOUND: "webhook_event_not_found",
  WEBHOOK_TRIGGER_NOT_FOUND: "webhook_trigger_not_found",
  SCHEDULE_NOT_FOUND: "schedule_not_found",
  SCHEDULED_ACTION_NOT_FOUND: "scheduled_action_not_found",
  SCHEDULE_TRIGGER_NOT_FOUND: "schedule_trigger_not_found",
  AGENT_BINDING_NOT_FOUND: "agent_binding_not_found",
  AGENT_BINDING_AMBIGUOUS: "agent_binding_ambiguous",
  AGENT_BINDING_RUNTIME_INCOMPATIBLE: "agent_binding_runtime_incompatible",
  AGENT_BINDING_CONNECTION_NOT_FOUND: "agent_binding_connection_not_found",
  AGENT_BINDING_TARGET_NOT_FOUND: "agent_binding_target_not_found",
  WEBHOOK_EVENT_SOURCE_ORDER_KEY_MISSING: "webhook_event_source_order_key_missing",
  TEMPLATE_RENDER_FAILED: "template_render_failed",
  TRIGGER_RUN_EXECUTION_FAILED: "trigger_run_execution_failed",
} as const;

class TriggerRunExecutionError extends Error {
  readonly code: string;

  constructor(input: { code: string; message: string; cause?: unknown }) {
    super(input.message, {
      cause: input.cause,
    });
    this.code = input.code;
  }
}

export function createTriggerRunExecutionError(input: {
  code: string;
  message: string;
  cause?: unknown;
}) {
  return new TriggerRunExecutionError(input);
}

export function resolveTriggerRunFailure(input: unknown): { code: string; message: string } {
  if (input instanceof TriggerRunExecutionError) {
    return {
      code: input.code,
      message: input.message,
    };
  }

  if (input instanceof Error) {
    return {
      code: TriggerRunFailureCodes.TRIGGER_RUN_EXECUTION_FAILED,
      message: input.message,
    };
  }

  return {
    code: TriggerRunFailureCodes.TRIGGER_RUN_EXECUTION_FAILED,
    message: "Trigger run execution failed with a non-error exception.",
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
    throw new TriggerRunExecutionError({
      code: TriggerRunFailureCodes.TEMPLATE_RENDER_FAILED,
      message: "Rendered trigger input template must not be empty.",
    });
  }

  const renderedConversationKey = renderTemplateString({
    template: input.templates.conversationKeyTemplate,
    context: input.context,
  });
  if (renderedConversationKey.trim().length === 0) {
    throw new TriggerRunExecutionError({
      code: TriggerRunFailureCodes.TEMPLATE_RENDER_FAILED,
      message: "Rendered trigger conversation key template must not be empty.",
    });
  }

  let renderedIdempotencyKey: string | null = null;
  if (input.templates.idempotencyKeyTemplate !== null) {
    renderedIdempotencyKey = renderTemplateString({
      template: input.templates.idempotencyKeyTemplate,
      context: input.context,
    });
    if (renderedIdempotencyKey.trim().length === 0) {
      throw new TriggerRunExecutionError({
        code: TriggerRunFailureCodes.TEMPLATE_RENDER_FAILED,
        message: "Rendered trigger idempotency key template must not be empty.",
      });
    }
  }

  return {
    renderedInput,
    renderedConversationKey,
    renderedIdempotencyKey,
  };
}

function resolvePersistedPreparedTriggerRunSnapshot(input: {
  triggerRun: {
    id: string;
    createdAt: string;
    triggerId: string;
    conversationId: string | null;
    renderedInput: string | null;
    renderedConversationKey: string | null;
    renderedIdempotencyKey: string | null;
    instructions: string | null;
  };
  triggerTarget: {
    id: string;
    sandboxProfileId: string;
    sandboxProfileVersion: number;
    primaryRepositoryId: string | null;
  };
  trigger: {
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
}): PreparedTriggerRun | null {
  const hasPersistedSnapshot =
    input.triggerRun.renderedInput !== null ||
    input.triggerRun.renderedConversationKey !== null ||
    input.triggerRun.renderedIdempotencyKey !== null;

  if (!hasPersistedSnapshot) {
    return null;
  }

  if (
    input.triggerRun.conversationId === null ||
    input.triggerRun.renderedInput === null ||
    input.triggerRun.renderedConversationKey === null
  ) {
    throw new TriggerRunExecutionError({
      code: TriggerRunFailureCodes.TRIGGER_RUN_EXECUTION_FAILED,
      message: `Trigger run '${input.triggerRun.id}' is missing persisted prepared state.`,
    });
  }

  return {
    triggerRunId: input.triggerRun.id,
    triggerRunCreatedAt: input.triggerRun.createdAt,
    triggerId: input.triggerRun.triggerId,
    conversationId: input.triggerRun.conversationId,
    triggerTargetId: input.triggerTarget.id,
    organizationId: input.trigger.organizationId,
    sandboxProfileId: input.triggerTarget.sandboxProfileId,
    sandboxProfileVersion: input.triggerTarget.sandboxProfileVersion,
    primaryRepositoryId: input.triggerTarget.primaryRepositoryId,
    workingDirectory: resolveTriggerRunWorkingDirectory({
      primaryRepositoryId: input.triggerTarget.primaryRepositoryId,
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
    renderedInput: input.triggerRun.renderedInput,
    renderedConversationKey: input.triggerRun.renderedConversationKey,
    renderedIdempotencyKey: input.triggerRun.renderedIdempotencyKey,
    instructions: input.triggerRun.instructions,
    collaborationModeSettings: null,
  };
}

function resolveTriggerRunWorkingDirectory(input: { primaryRepositoryId: string | null }): string {
  if (input.primaryRepositoryId === null) {
    return DefaultSandboxWorkspaceDir;
  }

  if (input.primaryRepositoryId.trim().length === 0) {
    throw new TriggerRunExecutionError({
      code: TriggerRunFailureCodes.TRIGGER_RUN_EXECUTION_FAILED,
      message: "Trigger target primary repository id must not be empty.",
    });
  }

  return `${DefaultSandboxWorkspaceDir}/${input.primaryRepositoryId}`;
}

async function resolveTriggerConversationBindingContext(
  db: ControlPlaneDatabase | ControlPlaneTransaction,
  input: {
    triggerRunId: string;
    organizationId: string;
    sandboxProfileId: string;
    sandboxProfileVersion: number;
  },
): Promise<{
  integrationFamilyId: string;
  runtimeId: string;
}> {
  const tables = getControlPlaneDatabaseSchema(db);
  const agentBindingRows = await db
    .select({
      agentRuntimeId: tables.sandboxProfileVersions.agentRuntimeId,
      bindingId: tables.sandboxProfileVersionIntegrationBindings.id,
      bindingConnectionId: tables.sandboxProfileVersionIntegrationBindings.connectionId,
      connectionId: tables.integrationConnections.id,
      connectionTargetKey: tables.integrationConnections.targetKey,
      targetFamilyId: tables.integrationTargets.familyId,
      targetVariantId: tables.integrationTargets.variantId,
    })
    .from(tables.sandboxProfileVersions)
    .leftJoin(
      tables.sandboxProfileVersionIntegrationBindings,
      and(
        eq(
          tables.sandboxProfileVersionIntegrationBindings.sandboxProfileId,
          tables.sandboxProfileVersions.sandboxProfileId,
        ),
        eq(
          tables.sandboxProfileVersionIntegrationBindings.sandboxProfileVersion,
          tables.sandboxProfileVersions.version,
        ),
        eq(tables.sandboxProfileVersionIntegrationBindings.kind, IntegrationBindingKinds.AGENT),
      ),
    )
    .leftJoin(
      tables.integrationConnections,
      and(
        eq(
          tables.integrationConnections.id,
          tables.sandboxProfileVersionIntegrationBindings.connectionId,
        ),
        eq(tables.integrationConnections.organizationId, input.organizationId),
      ),
    )
    .leftJoin(
      tables.integrationTargets,
      eq(tables.integrationTargets.targetKey, tables.integrationConnections.targetKey),
    )
    .where(
      and(
        eq(tables.sandboxProfileVersions.sandboxProfileId, input.sandboxProfileId),
        eq(tables.sandboxProfileVersions.version, input.sandboxProfileVersion),
      ),
    )
    .orderBy(tables.sandboxProfileVersionIntegrationBindings.id);

  const agentBindingRow = agentBindingRows[0];
  if (agentBindingRow === undefined) {
    throw new TriggerRunExecutionError({
      code: TriggerRunFailureCodes.TRIGGER_RUN_EXECUTION_FAILED,
      message: `Trigger run '${input.triggerRunId}' references missing sandbox profile '${input.sandboxProfileId}' version '${String(input.sandboxProfileVersion)}'.`,
    });
  }

  if (agentBindingRow.bindingId === null) {
    throw new TriggerRunExecutionError({
      code: TriggerRunFailureCodes.AGENT_BINDING_NOT_FOUND,
      message: `Trigger run '${input.triggerRunId}' requires at least one AGENT binding on sandbox profile '${input.sandboxProfileId}' version '${input.sandboxProfileVersion}', but none were found.`,
    });
  }

  let integrationFamilyId: string | null = null;
  let preferredIntegrationFamilyId: string | null = null;
  const primaryIntegrationFamilyId = resolvePrimaryConversationIntegrationFamilyId(
    agentBindingRow.agentRuntimeId,
  );
  const providerBindingIds = new Map<string, string>();
  for (const row of agentBindingRows) {
    if (row.bindingId === null) {
      throw new TriggerRunExecutionError({
        code: TriggerRunFailureCodes.AGENT_BINDING_NOT_FOUND,
        message: `Trigger run '${input.triggerRunId}' requires at least one AGENT binding on sandbox profile '${input.sandboxProfileId}' version '${input.sandboxProfileVersion}', but none were found.`,
      });
    }

    if (row.connectionId === null) {
      throw new TriggerRunExecutionError({
        code: TriggerRunFailureCodes.AGENT_BINDING_CONNECTION_NOT_FOUND,
        message: `Trigger run '${input.triggerRunId}' references AGENT binding '${row.bindingId}' with connection '${row.bindingConnectionId}' that is missing or inaccessible.`,
      });
    }

    if (row.targetFamilyId === null) {
      throw new TriggerRunExecutionError({
        code: TriggerRunFailureCodes.AGENT_BINDING_TARGET_NOT_FOUND,
        message: `Trigger run '${input.triggerRunId}' references AGENT connection '${row.connectionId}' with target '${row.connectionTargetKey}' that does not exist.`,
      });
    }

    if (row.targetVariantId === null) {
      throw new TriggerRunExecutionError({
        code: TriggerRunFailureCodes.AGENT_BINDING_TARGET_NOT_FOUND,
        message: `Trigger run '${input.triggerRunId}' references AGENT connection '${row.connectionId}' with target '${row.connectionTargetKey}' that does not define a variant.`,
      });
    }

    const agentDefinition = IntegrationRegistry.getDefinition({
      familyId: row.targetFamilyId,
      variantId: row.targetVariantId,
    });
    if (
      !agentDefinitionAllowsRuntime({
        definition: agentDefinition,
        runtimeId: agentBindingRow.agentRuntimeId,
      })
    ) {
      throw new TriggerRunExecutionError({
        code: TriggerRunFailureCodes.AGENT_BINDING_RUNTIME_INCOMPATIBLE,
        message: `Trigger run '${input.triggerRunId}' references AGENT binding '${row.bindingId}' for provider '${row.targetFamilyId}' that is not compatible with runtime '${agentBindingRow.agentRuntimeId}'.`,
      });
    }

    const providerKey = createAgentProviderKey({
      familyId: row.targetFamilyId,
      variantId: row.targetVariantId,
    });
    const firstBindingId = providerBindingIds.get(providerKey);
    if (firstBindingId !== undefined) {
      throw new TriggerRunExecutionError({
        code: TriggerRunFailureCodes.AGENT_BINDING_AMBIGUOUS,
        message: `Trigger run '${input.triggerRunId}' references AGENT binding '${row.bindingId}' that duplicates provider '${row.targetFamilyId}' already bound by '${firstBindingId}'.`,
      });
    }
    providerBindingIds.set(providerKey, row.bindingId);

    if (row.targetFamilyId === primaryIntegrationFamilyId) {
      preferredIntegrationFamilyId ??= row.targetFamilyId;
    }
    integrationFamilyId ??= row.targetFamilyId;
  }

  if (primaryIntegrationFamilyId !== null && preferredIntegrationFamilyId === null) {
    throw new TriggerRunExecutionError({
      code: TriggerRunFailureCodes.AGENT_BINDING_NOT_FOUND,
      message: `Trigger run '${input.triggerRunId}' requires an AGENT binding for provider '${primaryIntegrationFamilyId}' on sandbox profile '${input.sandboxProfileId}' version '${input.sandboxProfileVersion}', but none were found.`,
    });
  }

  if (integrationFamilyId === null) {
    throw new TriggerRunExecutionError({
      code: TriggerRunFailureCodes.TRIGGER_RUN_EXECUTION_FAILED,
      message: `Trigger run '${input.triggerRunId}' could not resolve a trigger conversation integration family.`,
    });
  }

  return {
    integrationFamilyId: preferredIntegrationFamilyId ?? integrationFamilyId,
    runtimeId: agentBindingRow.agentRuntimeId,
  };
}

export async function prepareTriggerRun(
  ctx: {
    db: ControlPlaneDatabase;
  },
  input: PrepareTriggerRunInput,
): Promise<PreparedTriggerRun> {
  const triggerRun = await ctx.db.query.triggerRuns.findFirst({
    where: (table, { eq: whereEq }) => whereEq(table.id, input.triggerRunId),
  });
  if (triggerRun === undefined) {
    throw new TriggerRunExecutionError({
      code: TriggerRunFailureCodes.TRIGGER_RUN_NOT_FOUND,
      message: `Trigger run '${input.triggerRunId}' was not found.`,
    });
  }

  const trigger = await ctx.db.query.triggers.findFirst({
    where: (table, { eq: whereEq }) => whereEq(table.id, triggerRun.triggerId),
  });
  if (trigger === undefined) {
    throw new TriggerRunExecutionError({
      code: TriggerRunFailureCodes.TRIGGER_NOT_FOUND,
      message: `Trigger '${triggerRun.triggerId}' was not found.`,
    });
  }

  const triggerTargetId = triggerRun.triggerTargetId;
  if (triggerTargetId === null) {
    throw new TriggerRunExecutionError({
      code: TriggerRunFailureCodes.TRIGGER_TARGET_REFERENCE_MISSING,
      message: `Trigger run '${input.triggerRunId}' does not reference a trigger target.`,
    });
  }

  const triggerTarget = await ctx.db.query.triggerTargets.findFirst({
    where: (table, { eq: whereEq }) => whereEq(table.id, triggerTargetId),
  });
  if (triggerTarget === undefined) {
    throw new TriggerRunExecutionError({
      code: TriggerRunFailureCodes.TRIGGER_TARGET_NOT_FOUND,
      message: `Trigger target '${triggerRun.triggerTargetId}' was not found.`,
    });
  }

  const sandboxProfileVersion = triggerTarget.sandboxProfileVersion;
  if (typeof sandboxProfileVersion !== "number") {
    throw new TriggerRunExecutionError({
      code: TriggerRunFailureCodes.TRIGGER_RUN_EXECUTION_FAILED,
      message: `Trigger target '${triggerTarget.id}' does not define a sandbox profile version.`,
    });
  }

  const sourceWebhookEventId = triggerRun.sourceWebhookEventId;
  const sourceScheduledActionId = triggerRun.sourceScheduledActionId;
  if (
    (sourceWebhookEventId === null && sourceScheduledActionId === null) ||
    (sourceWebhookEventId !== null && sourceScheduledActionId !== null)
  ) {
    throw new TriggerRunExecutionError({
      code: TriggerRunFailureCodes.TRIGGER_RUN_SOURCE_REFERENCE_MISSING,
      message: `Trigger run '${input.triggerRunId}' must reference exactly one trigger source.`,
    });
  }

  if (sourceScheduledActionId !== null) {
    return prepareScheduledTriggerRun(ctx, {
      trigger,
      triggerRun,
      triggerTarget,
      sandboxProfileVersion,
      sourceScheduledActionId,
    });
  }
  if (sourceWebhookEventId === null) {
    throw new TriggerRunExecutionError({
      code: TriggerRunFailureCodes.WEBHOOK_EVENT_REFERENCE_MISSING,
      message: `Trigger run '${input.triggerRunId}' does not reference a source webhook event.`,
    });
  }

  const webhookTrigger = await ctx.db.query.webhookTriggers.findFirst({
    where: (table, { eq: whereEq }) => whereEq(table.triggerId, triggerRun.triggerId),
  });
  if (webhookTrigger === undefined) {
    throw new TriggerRunExecutionError({
      code: TriggerRunFailureCodes.WEBHOOK_TRIGGER_NOT_FOUND,
      message: `Webhook trigger for trigger '${triggerRun.triggerId}' was not found.`,
    });
  }

  const webhookEvent = await ctx.db.query.integrationWebhookEvents.findFirst({
    where: (table, { eq: whereEq }) => whereEq(table.id, sourceWebhookEventId),
  });
  if (webhookEvent === undefined) {
    throw new TriggerRunExecutionError({
      code: TriggerRunFailureCodes.WEBHOOK_EVENT_NOT_FOUND,
      message: `Webhook event '${sourceWebhookEventId}' was not found.`,
    });
  }

  const persistedSnapshot = resolvePersistedPreparedTriggerRunSnapshot({
    triggerRun: {
      id: triggerRun.id,
      createdAt: triggerRun.createdAt,
      triggerId: triggerRun.triggerId,
      conversationId: triggerRun.conversationId,
      renderedInput: triggerRun.renderedInput,
      renderedConversationKey: triggerRun.renderedConversationKey,
      renderedIdempotencyKey: triggerRun.renderedIdempotencyKey,
      instructions: triggerRun.instructions,
    },
    triggerTarget: {
      id: triggerTarget.id,
      sandboxProfileId: triggerTarget.sandboxProfileId,
      sandboxProfileVersion,
      primaryRepositoryId: triggerTarget.primaryRepositoryId,
    },
    trigger: {
      organizationId: trigger.organizationId,
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
      throw new TriggerRunExecutionError({
        code: TriggerRunFailureCodes.WEBHOOK_EVENT_SOURCE_ORDER_KEY_MISSING,
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

  const idempotencyKeyTemplate = webhookTrigger.idempotencyKeyTemplate;
  const sourceOrderKey = webhookEvent.sourceOrderKey;
  if (sourceOrderKey === null || sourceOrderKey.trim().length === 0) {
    throw new TriggerRunExecutionError({
      code: TriggerRunFailureCodes.WEBHOOK_EVENT_SOURCE_ORDER_KEY_MISSING,
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
        triggerRun: {
          id: triggerRun.id,
          triggerId: triggerRun.triggerId,
          triggerTargetId: triggerTarget.id,
        },
        payload: webhookEvent.payload,
      },
      templates: {
        inputTemplate: webhookTrigger.inputTemplate,
        conversationKeyTemplate: webhookTrigger.conversationKeyTemplate,
        idempotencyKeyTemplate,
      },
    });
  } catch (error) {
    throw new TriggerRunExecutionError({
      code: TriggerRunFailureCodes.TEMPLATE_RENDER_FAILED,
      message: error instanceof Error ? error.message : "Template rendering failed.",
      cause: error,
    });
  }

  const bindingContext = await resolveTriggerConversationBindingContext(ctx.db, {
    triggerRunId: triggerRun.id,
    organizationId: trigger.organizationId,
    sandboxProfileId: triggerTarget.sandboxProfileId,
    sandboxProfileVersion,
  });

  const claimedConversationId = await ctx.db.transaction(async (tx) => {
    const tables = getControlPlaneDatabaseSchema(tx);

    const claimedTriggerConversation = await claimTriggerConversation(
      {
        db: tx,
      },
      {
        organizationId: trigger.organizationId,
        ownerKind: TriggerConversationOwnerKinds.TRIGGER_TARGET,
        ownerId: triggerTarget.id,
        createdByKind: TriggerConversationCreatedByKinds.WEBHOOK,
        createdById: webhookEvent.id,
        conversationKey: compiledTemplates.renderedConversationKey,
        sandboxProfileId: triggerTarget.sandboxProfileId,
        integrationFamilyId: bindingContext.integrationFamilyId,
        runtimeId: bindingContext.runtimeId,
      },
    );

    await tx
      .update(tables.triggerRuns)
      .set({
        conversationId: claimedTriggerConversation.id,
        renderedInput: compiledTemplates.renderedInput,
        renderedConversationKey: compiledTemplates.renderedConversationKey,
        renderedIdempotencyKey: compiledTemplates.renderedIdempotencyKey,
        instructions: webhookTrigger.instructions,
        updatedAt: sql`now()`,
      })
      .where(eq(tables.triggerRuns.id, triggerRun.id));

    return claimedTriggerConversation.id;
  });

  return {
    triggerRunId: triggerRun.id,
    triggerRunCreatedAt: triggerRun.createdAt,
    triggerId: triggerRun.triggerId,
    conversationId: claimedConversationId,
    triggerTargetId: triggerTarget.id,
    organizationId: trigger.organizationId,
    sandboxProfileId: triggerTarget.sandboxProfileId,
    sandboxProfileVersion,
    primaryRepositoryId: triggerTarget.primaryRepositoryId,
    workingDirectory: resolveTriggerRunWorkingDirectory({
      primaryRepositoryId: triggerTarget.primaryRepositoryId,
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
    instructions: webhookTrigger.instructions,
    collaborationModeSettings:
      webhookTrigger.instructions === null
        ? null
        : {
            developerInstructions: webhookTrigger.instructions,
          },
  };
}

async function prepareScheduledTriggerRun(
  ctx: {
    db: ControlPlaneDatabase;
  },
  input: {
    trigger: {
      organizationId: string;
    };
    triggerRun: {
      id: string;
      createdAt: string;
      triggerId: string;
      conversationId: string | null;
      renderedInput: string | null;
      renderedConversationKey: string | null;
      renderedIdempotencyKey: string | null;
      instructions: string | null;
    };
    triggerTarget: {
      id: string;
      sandboxProfileId: string;
      sandboxProfileVersion: number;
      primaryRepositoryId: string | null;
    };
    sandboxProfileVersion: number;
    sourceScheduledActionId: string;
  },
): Promise<PreparedTriggerRun> {
  const scheduledAction = await ctx.db.query.scheduledActions.findFirst({
    where: (table, { eq: whereEq }) => whereEq(table.id, input.sourceScheduledActionId),
  });
  if (scheduledAction === undefined) {
    throw new TriggerRunExecutionError({
      code: TriggerRunFailureCodes.SCHEDULED_ACTION_NOT_FOUND,
      message: `Scheduled action '${input.sourceScheduledActionId}' was not found.`,
    });
  }
  if (scheduledAction.organizationId !== input.trigger.organizationId) {
    throw new TriggerRunExecutionError({
      code: TriggerRunFailureCodes.TRIGGER_RUN_EXECUTION_FAILED,
      message: `Scheduled action '${scheduledAction.id}' organization does not match trigger run '${input.triggerRun.id}'.`,
    });
  }

  const schedule = await ctx.db.query.schedules.findFirst({
    where: (table, { eq: whereEq }) => whereEq(table.id, scheduledAction.scheduleId),
  });
  if (schedule === undefined) {
    throw new TriggerRunExecutionError({
      code: TriggerRunFailureCodes.SCHEDULE_NOT_FOUND,
      message: `Schedule '${scheduledAction.scheduleId}' for scheduled action '${scheduledAction.id}' was not found.`,
    });
  }
  if (schedule.organizationId !== input.trigger.organizationId) {
    throw new TriggerRunExecutionError({
      code: TriggerRunFailureCodes.TRIGGER_RUN_EXECUTION_FAILED,
      message: `Schedule '${schedule.id}' organization does not match trigger run '${input.triggerRun.id}'.`,
    });
  }
  if (schedule.targetType !== ScheduleTargetTypes.TRIGGER_RUN) {
    throw new TriggerRunExecutionError({
      code: TriggerRunFailureCodes.TRIGGER_RUN_EXECUTION_FAILED,
      message: `Schedule '${schedule.id}' target type '${schedule.targetType}' does not match trigger run '${input.triggerRun.id}'.`,
    });
  }

  const scheduleTrigger = await ctx.db.query.scheduleTriggers.findFirst({
    where: (table, { eq: whereEq }) => whereEq(table.scheduleId, scheduledAction.scheduleId),
  });
  if (scheduleTrigger === undefined) {
    throw new TriggerRunExecutionError({
      code: TriggerRunFailureCodes.SCHEDULE_TRIGGER_NOT_FOUND,
      message: `Schedule trigger target for schedule '${scheduledAction.scheduleId}' was not found.`,
    });
  }
  if (scheduleTrigger.triggerId !== input.triggerRun.triggerId) {
    throw new TriggerRunExecutionError({
      code: TriggerRunFailureCodes.TRIGGER_RUN_EXECUTION_FAILED,
      message: `Schedule trigger '${scheduleTrigger.triggerId}' does not match trigger run '${input.triggerRun.id}'.`,
    });
  }

  const scheduledAt = normalizeScheduledAt(scheduledAction.scheduledAt, scheduledAction.id);
  const sourceOrderKey = `${scheduledAt}#${scheduledAction.id}`;
  const preparedRunBase = {
    triggerRunId: input.triggerRun.id,
    triggerRunCreatedAt: input.triggerRun.createdAt,
    triggerId: input.triggerRun.triggerId,
    triggerTargetId: input.triggerTarget.id,
    organizationId: input.trigger.organizationId,
    sandboxProfileId: input.triggerTarget.sandboxProfileId,
    sandboxProfileVersion: input.sandboxProfileVersion,
    primaryRepositoryId: input.triggerTarget.primaryRepositoryId,
    workingDirectory: resolveTriggerRunWorkingDirectory({
      primaryRepositoryId: input.triggerTarget.primaryRepositoryId,
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
    PreparedTriggerRun,
    "conversationId" | "renderedInput" | "renderedConversationKey" | "renderedIdempotencyKey"
  >;
  const hasPersistedSnapshot =
    input.triggerRun.renderedInput !== null ||
    input.triggerRun.renderedConversationKey !== null ||
    input.triggerRun.renderedIdempotencyKey !== null;
  if (hasPersistedSnapshot) {
    if (
      input.triggerRun.conversationId === null ||
      input.triggerRun.renderedInput === null ||
      input.triggerRun.renderedConversationKey === null
    ) {
      throw new TriggerRunExecutionError({
        code: TriggerRunFailureCodes.TRIGGER_RUN_EXECUTION_FAILED,
        message: `Trigger run '${input.triggerRun.id}' is missing persisted prepared state.`,
      });
    }

    return {
      ...preparedRunBase,
      conversationId: input.triggerRun.conversationId,
      renderedInput: input.triggerRun.renderedInput,
      renderedConversationKey: input.triggerRun.renderedConversationKey,
      renderedIdempotencyKey: input.triggerRun.renderedIdempotencyKey,
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
        triggerRun: {
          id: input.triggerRun.id,
          triggerId: input.triggerRun.triggerId,
          triggerTargetId: input.triggerTarget.id,
        },
        payload: {},
      },
      templates: {
        inputTemplate: scheduleTrigger.inputTemplate,
        conversationKeyTemplate: scheduleTrigger.conversationKeyTemplate,
        idempotencyKeyTemplate: scheduleTrigger.idempotencyKeyTemplate,
      },
    });
  } catch (error) {
    throw new TriggerRunExecutionError({
      code: TriggerRunFailureCodes.TEMPLATE_RENDER_FAILED,
      message: error instanceof Error ? error.message : "Template rendering failed.",
      cause: error,
    });
  }

  const bindingContext = await resolveTriggerConversationBindingContext(ctx.db, {
    triggerRunId: input.triggerRun.id,
    organizationId: input.trigger.organizationId,
    sandboxProfileId: input.triggerTarget.sandboxProfileId,
    sandboxProfileVersion: input.sandboxProfileVersion,
  });

  const claimedConversationId = await ctx.db.transaction(async (tx) => {
    const tables = getControlPlaneDatabaseSchema(tx);

    const claimedTriggerConversation = await claimTriggerConversation(
      {
        db: tx,
      },
      {
        organizationId: input.trigger.organizationId,
        ownerKind: TriggerConversationOwnerKinds.TRIGGER_TARGET,
        ownerId: input.triggerTarget.id,
        createdByKind: TriggerConversationCreatedByKinds.SCHEDULE,
        createdById: scheduledAction.id,
        conversationKey: compiledTemplates.renderedConversationKey,
        sandboxProfileId: input.triggerTarget.sandboxProfileId,
        integrationFamilyId: bindingContext.integrationFamilyId,
        runtimeId: bindingContext.runtimeId,
      },
    );

    await tx
      .update(tables.triggerRuns)
      .set({
        conversationId: claimedTriggerConversation.id,
        renderedInput: compiledTemplates.renderedInput,
        renderedConversationKey: compiledTemplates.renderedConversationKey,
        renderedIdempotencyKey: compiledTemplates.renderedIdempotencyKey,
        instructions: null,
        updatedAt: sql`now()`,
      })
      .where(eq(tables.triggerRuns.id, input.triggerRun.id));

    return claimedTriggerConversation.id;
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
    throw new TriggerRunExecutionError({
      code: TriggerRunFailureCodes.TRIGGER_RUN_EXECUTION_FAILED,
      message: `Scheduled action '${scheduledActionId}' has invalid scheduled_at '${scheduledAt}'.`,
    });
  }

  return timestamp.toISOString();
}

export async function ensureTriggerSandbox(
  ctx: EnsureTriggerSandboxDependencies,
  input: {
    preparedTriggerRun: PreparedTriggerRun;
  },
): Promise<EnsuredTriggerSandbox> {
  const triggerRun = await ctx.db.query.triggerRuns.findFirst({
    where: (table, { eq: whereEq }) => whereEq(table.id, input.preparedTriggerRun.triggerRunId),
  });
  if (triggerRun === undefined) {
    throw new TriggerRunExecutionError({
      code: TriggerRunFailureCodes.TRIGGER_RUN_NOT_FOUND,
      message: `Trigger run '${input.preparedTriggerRun.triggerRunId}' was not found.`,
    });
  }

  if (triggerRun.status !== TriggerRunStatuses.RUNNING) {
    throw new TriggerRunExecutionError({
      code: TriggerRunFailureCodes.TRIGGER_RUN_EXECUTION_FAILED,
      message: `Trigger run '${triggerRun.id}' is not running while ensuring sandbox.`,
    });
  }

  const startedSandbox = await ctx.controlPlaneInternalClient.startSandboxProfileInstance({
    organizationId: input.preparedTriggerRun.organizationId,
    profileId: input.preparedTriggerRun.sandboxProfileId,
    profileVersion: input.preparedTriggerRun.sandboxProfileVersion,
    primaryRepositoryId: input.preparedTriggerRun.primaryRepositoryId,
    startedBy: {
      kind: "system",
      id: input.preparedTriggerRun.triggerRunId,
    },
    source: input.preparedTriggerRun.sourceKind,
    ...(input.preparedTriggerRun.actingUserId === undefined
      ? {}
      : {
          actingUser: {
            userId: input.preparedTriggerRun.actingUserId,
          },
        }),
  });

  return {
    sandboxInstanceId: startedSandbox.sandboxInstanceId,
    startupWorkflowRunId: startedSandbox.workflowRunId,
  };
}

async function updateTriggerRunTerminalState(
  ctx: {
    db: ControlPlaneDatabase;
  },
  input: UpdateTriggerRunTerminalStateInput,
): Promise<void> {
  const tables = getControlPlaneDatabaseSchema(ctx.db);

  await ctx.db
    .update(tables.triggerRuns)
    .set({
      status: input.status,
      failureCode: input.failureCode,
      failureMessage: input.failureMessage,
      finishedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(tables.triggerRuns.id, input.triggerRunId),
        eq(tables.triggerRuns.status, TriggerRunStatuses.RUNNING),
      ),
    );
}

export async function markTriggerRunCompleted(
  ctx: {
    db: ControlPlaneDatabase;
  },
  input: TriggerRunIdInput,
): Promise<void> {
  await updateTriggerRunTerminalState(ctx, {
    triggerRunId: input.triggerRunId,
    status: TriggerRunStatuses.COMPLETED,
    failureCode: null,
    failureMessage: null,
  });
}

export async function markTriggerRunFailed(
  ctx: {
    db: ControlPlaneDatabase;
  },
  input: MarkTriggerRunFailedInput,
): Promise<void> {
  await updateTriggerRunTerminalState(ctx, {
    triggerRunId: input.triggerRunId,
    status: TriggerRunStatuses.FAILED,
    failureCode: input.failureCode,
    failureMessage: input.failureMessage,
  });
}

export async function markTriggerRunIgnored(
  ctx: {
    db: ControlPlaneDatabase;
  },
  input: TriggerRunIdInput,
): Promise<void> {
  await updateTriggerRunTerminalState(ctx, {
    triggerRunId: input.triggerRunId,
    status: TriggerRunStatuses.IGNORED,
    failureCode: null,
    failureMessage: null,
  });
}
