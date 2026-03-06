import { renderTemplateString } from "@mistle/automations";
import { ControlPlaneInternalClientError } from "@mistle/control-plane-internal-client";
import {
  automationRuns,
  AutomationRunStatuses,
  ConversationCreatedByKinds,
  ConversationOwnerKinds,
  ConversationProviderFamilies,
  ConversationRouteStatuses,
  type AutomationRunStatus,
  type ControlPlaneDatabase,
  IntegrationBindingKinds,
} from "@mistle/db/control-plane";
import { systemSleeper } from "@mistle/time";
import type { HandleAutomationRunWorkflowInput } from "@mistle/workflows/control-plane";
import { and, eq, sql } from "drizzle-orm";

import {
  activateConversationRoute,
  claimConversation,
  ConversationPersistenceError,
  ConversationPersistenceErrorCodes,
  ConversationProviderError,
  ConversationProviderErrorCodes,
  createConversationRoute,
  getConversationProviderAdapter,
  rebindConversationSandbox,
  replaceConversationBinding,
  updateConversationExecution,
} from "../conversations/index.js";
import type {
  ClaimAutomationConversationServiceInput,
  ClaimAutomationConversationServiceOutput,
  EnsureAutomationConversationBindingServiceInput,
  EnsureAutomationConversationBindingServiceOutput,
  EnsureAutomationConversationRouteServiceInput,
  EnsureAutomationConversationRouteServiceOutput,
  EnsureAutomationConversationSandboxServiceInput,
  EnsureAutomationConversationSandboxServiceOutput,
  ExecuteAutomationConversationServiceInput,
  ExecuteAutomationConversationServiceOutput,
  HandleAutomationRunMarkFailedServiceInput,
  HandleAutomationRunResolveFailureServiceOutput,
  HandleAutomationRunServiceDependencies,
  PersistAutomationConversationExecutionServiceInput,
  PrepareAutomationRunServiceOutput,
} from "./types.js";

export type HandleAutomationRunDependencies = {
  db: ControlPlaneDatabase;
};

export type EnsureAutomationConversationSandboxDependencies = Pick<
  HandleAutomationRunServiceDependencies,
  "db" | "startSandboxProfileInstance" | "getSandboxInstance"
>;

export type ProviderAutomationConversationDependencies = Pick<
  HandleAutomationRunServiceDependencies,
  "mintSandboxConnectionToken"
>;

export type PersistAutomationConversationExecutionDependencies = {
  db: ControlPlaneDatabase;
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
  AUTOMATION_TARGET_BINDING_AMBIGUOUS: "automation_target_binding_ambiguous",
  AUTOMATION_TARGET_BINDING_MISSING: "automation_target_binding_missing",
  AUTOMATION_TARGET_BINDING_INVALID: "automation_target_binding_invalid",
  AUTOMATION_TARGET_PROVIDER_UNSUPPORTED: "automation_target_provider_unsupported",
  WEBHOOK_EVENT_REFERENCE_MISSING: "webhook_event_reference_missing",
  WEBHOOK_EVENT_NOT_FOUND: "webhook_event_not_found",
  WEBHOOK_AUTOMATION_NOT_FOUND: "webhook_automation_not_found",
  TEMPLATE_RENDER_FAILED: "template_render_failed",
  AUTOMATION_RUN_EXECUTION_FAILED: "automation_run_execution_failed",
  CONVERSATION_RECOVERY_FAILED: "conversation_recovery_failed",
  CONVERSATION_SNAPSHOT_MISSING: "conversation_snapshot_missing",
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveProviderFamilyFromTargetFamily(targetFamilyId: string): string {
  if (targetFamilyId === "openai") {
    return ConversationProviderFamilies.CODEX;
  }

  throw new AutomationRunExecutionError({
    code: AutomationRunFailureCodes.AUTOMATION_TARGET_PROVIDER_UNSUPPORTED,
    message: `Automation target uses unsupported integration family '${targetFamilyId}' for conversation delivery.`,
  });
}

function resolveProviderModelFromBindingConfig(config: unknown): string {
  if (!isRecord(config)) {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.AUTOMATION_TARGET_BINDING_INVALID,
      message: "Automation target binding config must be an object.",
    });
  }

  const defaultModelValue = config.defaultModel;
  if (typeof defaultModelValue !== "string" || defaultModelValue.trim().length === 0) {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.AUTOMATION_TARGET_BINDING_INVALID,
      message: "Automation target binding config.defaultModel must be a non-empty string.",
    });
  }

  return defaultModelValue;
}

function isNotFoundControlPlaneSandboxError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.message.includes("status 404");
}

export function resolveAutomationRunFailure(
  input: unknown,
): HandleAutomationRunResolveFailureServiceOutput {
  if (input instanceof AutomationRunExecutionError) {
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

  const sandboxProfileVersion = automationTarget.sandboxProfileVersion;
  if (sandboxProfileVersion === null) {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.AUTOMATION_RUN_EXECUTION_FAILED,
      message: `Automation target '${automationTarget.id}' does not define a sandbox profile version.`,
    });
  }

  const agentBindings = await deps.db.query.sandboxProfileVersionIntegrationBindings.findMany({
    where: (table, { and: whereAnd, eq: whereEq }) =>
      whereAnd(
        whereEq(table.sandboxProfileId, automationTarget.sandboxProfileId),
        whereEq(table.sandboxProfileVersion, sandboxProfileVersion),
        whereEq(table.kind, IntegrationBindingKinds.AGENT),
      ),
  });

  if (agentBindings.length === 0) {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.AUTOMATION_TARGET_BINDING_MISSING,
      message: `Sandbox profile '${automationTarget.sandboxProfileId}' version '${String(sandboxProfileVersion)}' does not have an agent integration binding.`,
    });
  }
  if (agentBindings.length > 1) {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.AUTOMATION_TARGET_BINDING_AMBIGUOUS,
      message: `Sandbox profile '${automationTarget.sandboxProfileId}' version '${String(sandboxProfileVersion)}' has multiple agent integration bindings.`,
    });
  }

  const agentBinding = agentBindings[0];
  if (agentBinding === undefined) {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.AUTOMATION_TARGET_BINDING_MISSING,
      message: "Expected an agent integration binding but none was available.",
    });
  }

  const bindingConnection = await deps.db.query.integrationConnections.findFirst({
    where: (table, { eq: whereEq }) => whereEq(table.id, agentBinding.connectionId),
  });
  if (bindingConnection === undefined) {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.AUTOMATION_TARGET_BINDING_INVALID,
      message: `Integration binding '${agentBinding.id}' references missing connection '${agentBinding.connectionId}'.`,
    });
  }

  const bindingTarget = await deps.db.query.integrationTargets.findFirst({
    where: (table, { eq: whereEq }) => whereEq(table.targetKey, bindingConnection.targetKey),
  });
  if (bindingTarget === undefined) {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.AUTOMATION_TARGET_BINDING_INVALID,
      message: `Integration binding '${agentBinding.id}' references missing target '${bindingConnection.targetKey}'.`,
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
    providerFamily: resolveProviderFamilyFromTargetFamily(bindingTarget.familyId),
    providerModel: resolveProviderModelFromBindingConfig(agentBinding.config),
  };
}

async function waitForSandboxInstanceRunning(
  deps: Pick<EnsureAutomationConversationSandboxDependencies, "getSandboxInstance">,
  input: {
    organizationId: string;
    sandboxInstanceId: string;
    timeoutMs?: number;
  },
): Promise<void> {
  const timeoutMs = input.timeoutMs ?? SandboxStartTimeoutMs;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    let sandboxInstance: {
      id: string;
      status: "starting" | "running" | "stopped" | "failed";
      failureCode: string | null;
      failureMessage: string | null;
    } | null = null;

    try {
      sandboxInstance = await deps.getSandboxInstance({
        organizationId: input.organizationId,
        instanceId: input.sandboxInstanceId,
      });
    } catch (error) {
      throw new AutomationRunExecutionError({
        code: AutomationRunFailureCodes.CONVERSATION_RECOVERY_FAILED,
        message:
          error instanceof Error
            ? error.message
            : `Failed to poll sandbox instance '${input.sandboxInstanceId}'.`,
        cause: error,
      });
    }

    if (sandboxInstance.status === "running") {
      return;
    }

    if (sandboxInstance.status === "failed") {
      throw new AutomationRunExecutionError({
        code: AutomationRunFailureCodes.CONVERSATION_RECOVERY_FAILED,
        message:
          sandboxInstance.failureMessage ??
          `Sandbox instance '${sandboxInstance.id}' entered terminal status '${sandboxInstance.status}'.`,
      });
    }

    if (sandboxInstance.status === "stopped") {
      throw new AutomationRunExecutionError({
        code: AutomationRunFailureCodes.CONVERSATION_RECOVERY_FAILED,
        message:
          sandboxInstance.failureMessage ??
          `Sandbox instance '${sandboxInstance.id}' entered terminal status '${sandboxInstance.status}'.`,
      });
    }

    await systemSleeper.sleep(SandboxStartPollIntervalMs);
  }

  throw new AutomationRunExecutionError({
    code: AutomationRunFailureCodes.CONVERSATION_RECOVERY_FAILED,
    message: `Sandbox instance '${input.sandboxInstanceId}' did not become ready before timeout elapsed.`,
  });
}

async function startAndWaitForSandbox(
  deps: Pick<
    EnsureAutomationConversationSandboxDependencies,
    "startSandboxProfileInstance" | "getSandboxInstance"
  >,
  input: {
    organizationId: string;
    sandboxProfileId: string;
    sandboxProfileVersion: number;
    automationRunId: string;
    restoreFromSourceInstanceId?: string;
    sandboxInstanceId?: string;
  },
): Promise<{
  sandboxInstanceId: string;
  workflowRunId: string;
}> {
  let startedSandbox: {
    workflowRunId: string;
    sandboxInstanceId: string;
  } | null = null;

  try {
    startedSandbox = await deps.startSandboxProfileInstance({
      organizationId: input.organizationId,
      profileId: input.sandboxProfileId,
      profileVersion: input.sandboxProfileVersion,
      startedBy: {
        kind: "system",
        id: input.automationRunId,
      },
      source: "webhook",
      ...(input.restoreFromSourceInstanceId === undefined
        ? {}
        : {
            restoreFromSourceInstanceId: input.restoreFromSourceInstanceId,
          }),
      ...(input.sandboxInstanceId === undefined
        ? {}
        : {
            sandboxInstanceId: input.sandboxInstanceId,
          }),
    });
  } catch (error) {
    if (error instanceof ControlPlaneInternalClientError && error.code === "SNAPSHOT_NOT_FOUND") {
      throw new AutomationRunExecutionError({
        code: AutomationRunFailureCodes.CONVERSATION_SNAPSHOT_MISSING,
        message:
          input.restoreFromSourceInstanceId === undefined
            ? "Sandbox snapshot required for conversation recovery was not found."
            : `Sandbox snapshot for source instance '${input.restoreFromSourceInstanceId}' was not found.`,
        cause: error,
      });
    }

    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.CONVERSATION_RECOVERY_FAILED,
      message:
        error instanceof Error
          ? error.message
          : `Failed to start sandbox profile '${input.sandboxProfileId}'.`,
      cause: error,
    });
  }

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
  deps: Pick<EnsureAutomationConversationSandboxDependencies, "getSandboxInstance">,
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

    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.CONVERSATION_RECOVERY_FAILED,
      message:
        error instanceof Error
          ? error.message
          : `Failed to read sandbox instance '${input.sandboxInstanceId}'.`,
      cause: error,
    });
  }
}

async function withConversationProviderConnection<TOutput>(
  deps: ProviderAutomationConversationDependencies,
  input: {
    organizationId: string;
    sandboxInstanceId: string;
    providerFamily: string;
  },
  callback: (context: {
    adapter: ReturnType<typeof getConversationProviderAdapter>;
    connection: Awaited<ReturnType<ReturnType<typeof getConversationProviderAdapter>["connect"]>>;
  }) => Promise<TOutput>,
): Promise<TOutput> {
  if (input.providerFamily !== ConversationProviderFamilies.CODEX) {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.AUTOMATION_TARGET_PROVIDER_UNSUPPORTED,
      message: `Unsupported conversation provider family '${input.providerFamily}'.`,
    });
  }

  const mintedConnection = await deps.mintSandboxConnectionToken({
    organizationId: input.organizationId,
    instanceId: input.sandboxInstanceId,
  });

  if (mintedConnection.url.trim().length === 0) {
    throw new AutomationRunExecutionError({
      code: AutomationRunFailureCodes.CONVERSATION_RECOVERY_FAILED,
      message: "Sandbox connection URL must not be empty.",
    });
  }

  const adapter = getConversationProviderAdapter(ConversationProviderFamilies.CODEX);
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

export async function claimAutomationConversation(
  deps: Pick<HandleAutomationRunDependencies, "db">,
  input: ClaimAutomationConversationServiceInput,
): Promise<ClaimAutomationConversationServiceOutput> {
  const claimedConversation = await claimConversation(
    {
      db: deps.db,
    },
    {
      organizationId: input.preparedAutomationRun.organizationId,
      ownerKind: ConversationOwnerKinds.AUTOMATION_TARGET,
      ownerId: input.preparedAutomationRun.automationTargetId,
      createdByKind: ConversationCreatedByKinds.WEBHOOK,
      createdById: input.preparedAutomationRun.automationId,
      conversationKey: input.preparedAutomationRun.renderedConversationKey,
      sandboxProfileId: input.preparedAutomationRun.sandboxProfileId,
      providerFamily: ConversationProviderFamilies.CODEX,
      preview: input.preparedAutomationRun.renderedInput,
    },
  );

  return {
    conversationId: claimedConversation.id,
    providerFamily: claimedConversation.providerFamily,
  };
}

export async function ensureAutomationConversationSandbox(
  deps: EnsureAutomationConversationSandboxDependencies,
  input: EnsureAutomationConversationSandboxServiceInput,
): Promise<EnsureAutomationConversationSandboxServiceOutput> {
  const existingRoute = await deps.db.query.conversationRoutes.findFirst({
    where: (table, { eq: whereEq }) =>
      whereEq(table.conversationId, input.claimedAutomationConversation.conversationId),
  });

  if (existingRoute === undefined) {
    const startedSandbox = await startAndWaitForSandbox(
      {
        startSandboxProfileInstance: deps.startSandboxProfileInstance,
        getSandboxInstance: deps.getSandboxInstance,
      },
      {
        organizationId: input.preparedAutomationRun.organizationId,
        sandboxProfileId: input.preparedAutomationRun.sandboxProfileId,
        sandboxProfileVersion: input.preparedAutomationRun.sandboxProfileVersion,
        automationRunId: input.preparedAutomationRun.automationRunId,
      },
    );

    return {
      sandboxInstanceId: startedSandbox.sandboxInstanceId,
      startupWorkflowRunId: startedSandbox.workflowRunId,
      routeId: null,
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
      organizationId: input.preparedAutomationRun.organizationId,
      sandboxInstanceId: existingRoute.sandboxInstanceId,
    },
  );

  if (routeSandboxStatus === "running") {
    return {
      sandboxInstanceId: existingRoute.sandboxInstanceId,
      startupWorkflowRunId: null,
      routeId: existingRoute.id,
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
        organizationId: input.preparedAutomationRun.organizationId,
        sandboxInstanceId: existingRoute.sandboxInstanceId,
      },
    );

    return {
      sandboxInstanceId: existingRoute.sandboxInstanceId,
      startupWorkflowRunId: null,
      routeId: existingRoute.id,
      providerConversationId: existingRoute.providerConversationId,
      providerExecutionId: existingRoute.providerExecutionId,
    };
  }

  if (routeSandboxStatus === "stopped") {
    const resumedSandbox = await startAndWaitForSandbox(
      {
        startSandboxProfileInstance: deps.startSandboxProfileInstance,
        getSandboxInstance: deps.getSandboxInstance,
      },
      {
        organizationId: input.preparedAutomationRun.organizationId,
        sandboxProfileId: input.preparedAutomationRun.sandboxProfileId,
        sandboxProfileVersion: input.preparedAutomationRun.sandboxProfileVersion,
        automationRunId: input.preparedAutomationRun.automationRunId,
        restoreFromSourceInstanceId: existingRoute.sandboxInstanceId,
        sandboxInstanceId: existingRoute.sandboxInstanceId,
      },
    );

    if (resumedSandbox.sandboxInstanceId !== existingRoute.sandboxInstanceId) {
      throw new AutomationRunExecutionError({
        code: AutomationRunFailureCodes.CONVERSATION_RECOVERY_FAILED,
        message: `Stopped sandbox '${existingRoute.sandboxInstanceId}' resumed as unexpected instance '${resumedSandbox.sandboxInstanceId}'.`,
      });
    }

    return {
      sandboxInstanceId: existingRoute.sandboxInstanceId,
      startupWorkflowRunId: resumedSandbox.workflowRunId,
      routeId: existingRoute.id,
      providerConversationId: existingRoute.providerConversationId,
      providerExecutionId: existingRoute.providerExecutionId,
    };
  }

  if (routeSandboxStatus === "missing" || routeSandboxStatus === "failed") {
    const restoredSandbox = await startAndWaitForSandbox(
      {
        startSandboxProfileInstance: deps.startSandboxProfileInstance,
        getSandboxInstance: deps.getSandboxInstance,
      },
      {
        organizationId: input.preparedAutomationRun.organizationId,
        sandboxProfileId: input.preparedAutomationRun.sandboxProfileId,
        sandboxProfileVersion: input.preparedAutomationRun.sandboxProfileVersion,
        automationRunId: input.preparedAutomationRun.automationRunId,
        restoreFromSourceInstanceId: existingRoute.sandboxInstanceId,
      },
    );

    const reboundRoute = await rebindConversationSandbox(
      {
        db: deps.db,
      },
      {
        routeId: existingRoute.id,
        sandboxInstanceId: restoredSandbox.sandboxInstanceId,
      },
    );

    return {
      sandboxInstanceId: reboundRoute.sandboxInstanceId,
      startupWorkflowRunId: restoredSandbox.workflowRunId,
      routeId: reboundRoute.id,
      providerConversationId: reboundRoute.providerConversationId,
      providerExecutionId: reboundRoute.providerExecutionId,
    };
  }

  const startedSandbox = await startAndWaitForSandbox(
    {
      startSandboxProfileInstance: deps.startSandboxProfileInstance,
      getSandboxInstance: deps.getSandboxInstance,
    },
    {
      organizationId: input.preparedAutomationRun.organizationId,
      sandboxProfileId: input.preparedAutomationRun.sandboxProfileId,
      sandboxProfileVersion: input.preparedAutomationRun.sandboxProfileVersion,
      automationRunId: input.preparedAutomationRun.automationRunId,
    },
  );

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
    sandboxInstanceId: reboundRoute.sandboxInstanceId,
    startupWorkflowRunId: startedSandbox.workflowRunId,
    routeId: reboundRoute.id,
    providerConversationId: reboundRoute.providerConversationId,
    providerExecutionId: reboundRoute.providerExecutionId,
  };
}

export async function ensureAutomationConversationRoute(
  deps: Pick<HandleAutomationRunDependencies, "db">,
  input: EnsureAutomationConversationRouteServiceInput,
): Promise<EnsureAutomationConversationRouteServiceOutput> {
  if (input.ensuredAutomationConversationSandbox.routeId !== null) {
    return {
      routeId: input.ensuredAutomationConversationSandbox.routeId,
      sandboxInstanceId: input.ensuredAutomationConversationSandbox.sandboxInstanceId,
      providerConversationId: input.ensuredAutomationConversationSandbox.providerConversationId,
      providerExecutionId: input.ensuredAutomationConversationSandbox.providerExecutionId,
    };
  }

  const route = await createConversationRoute(
    {
      db: deps.db,
    },
    {
      conversationId: input.claimedAutomationConversation.conversationId,
      sandboxInstanceId: input.ensuredAutomationConversationSandbox.sandboxInstanceId,
    },
  );

  return {
    routeId: route.id,
    sandboxInstanceId: route.sandboxInstanceId,
    providerConversationId: route.providerConversationId,
    providerExecutionId: route.providerExecutionId,
  };
}

export async function ensureAutomationConversationBinding(
  deps: Pick<HandleAutomationRunDependencies, "db"> & ProviderAutomationConversationDependencies,
  input: EnsureAutomationConversationBindingServiceInput,
): Promise<EnsureAutomationConversationBindingServiceOutput> {
  const providerCreateOptions: Record<string, unknown> = {
    model: input.preparedAutomationRun.providerModel,
  };

  return withConversationProviderConnection(
    {
      mintSandboxConnectionToken: deps.mintSandboxConnectionToken,
    },
    {
      organizationId: input.preparedAutomationRun.organizationId,
      sandboxInstanceId: input.routedAutomationConversation.sandboxInstanceId,
      providerFamily: input.claimedAutomationConversation.providerFamily,
    },
    async ({ adapter, connection }) => {
      if (input.routedAutomationConversation.providerConversationId === null) {
        const createdConversation = await adapter.createConversation({
          connection,
          options: providerCreateOptions,
        });

        const activatedRoute = await activateConversationRoute(
          {
            db: deps.db,
          },
          {
            conversationId: input.claimedAutomationConversation.conversationId,
            routeId: input.routedAutomationConversation.routeId,
            sandboxInstanceId: input.routedAutomationConversation.sandboxInstanceId,
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
        providerConversationId: input.routedAutomationConversation.providerConversationId,
      });

      if (inspectedConversation.status === "error") {
        throw new AutomationRunExecutionError({
          code: AutomationRunFailureCodes.CONVERSATION_RECOVERY_FAILED,
          message: `Provider conversation '${input.routedAutomationConversation.providerConversationId}' is in error state.`,
        });
      }

      if (inspectedConversation.exists) {
        const inspectedStatus = inspectedConversation.status === "active" ? "active" : "idle";
        return {
          routeId: input.routedAutomationConversation.routeId,
          sandboxInstanceId: input.routedAutomationConversation.sandboxInstanceId,
          providerConversationId: input.routedAutomationConversation.providerConversationId,
          providerExecutionId: input.routedAutomationConversation.providerExecutionId,
          providerStatus: inspectedStatus,
          resumeRequired: inspectedStatus === "idle",
        };
      }

      const createdConversation = await adapter.createConversation({
        connection,
        options: providerCreateOptions,
      });

      const replacedRoute = await replaceConversationBinding(
        {
          db: deps.db,
        },
        {
          routeId: input.routedAutomationConversation.routeId,
          sandboxInstanceId: input.routedAutomationConversation.sandboxInstanceId,
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
        routeId: replacedRoute.id,
        sandboxInstanceId: replacedRoute.sandboxInstanceId,
        providerConversationId: createdConversation.providerConversationId,
        providerExecutionId: replacedRoute.providerExecutionId,
        providerStatus: "idle",
        resumeRequired: false,
      };
    },
  );
}

export async function executeAutomationConversation(
  deps: ProviderAutomationConversationDependencies,
  input: ExecuteAutomationConversationServiceInput,
): Promise<ExecuteAutomationConversationServiceOutput> {
  return withConversationProviderConnection(
    {
      mintSandboxConnectionToken: deps.mintSandboxConnectionToken,
    },
    {
      organizationId: input.preparedAutomationRun.organizationId,
      sandboxInstanceId: input.boundAutomationConversation.sandboxInstanceId,
      providerFamily: input.preparedAutomationRun.providerFamily,
    },
    async ({ adapter, connection }) => {
      if (input.boundAutomationConversation.providerStatus === "active") {
        if (adapter.steerExecution === undefined) {
          throw new ConversationProviderError({
            code: ConversationProviderErrorCodes.PROVIDER_STEER_NOT_SUPPORTED,
            message: `Provider '${input.preparedAutomationRun.providerFamily}' does not support steering active executions.`,
          });
        }

        if (input.boundAutomationConversation.providerExecutionId === null) {
          throw new ConversationProviderError({
            code: ConversationProviderErrorCodes.PROVIDER_EXECUTION_MISSING,
            message:
              "Provider reported an active conversation execution but no persisted provider execution id was available.",
          });
        }

        const steeredExecution = await adapter.steerExecution({
          connection,
          providerConversationId: input.boundAutomationConversation.providerConversationId,
          providerExecutionId: input.boundAutomationConversation.providerExecutionId,
          inputText: input.preparedAutomationRun.renderedInput,
        });

        return steeredExecution.providerState === undefined
          ? {
              providerExecutionId: steeredExecution.providerExecutionId,
            }
          : {
              providerExecutionId: steeredExecution.providerExecutionId,
              providerState: steeredExecution.providerState,
            };
      }

      if (input.boundAutomationConversation.resumeRequired) {
        await adapter.resumeConversation({
          connection,
          providerConversationId: input.boundAutomationConversation.providerConversationId,
        });
      }

      const startedExecution = await adapter.startExecution({
        connection,
        providerConversationId: input.boundAutomationConversation.providerConversationId,
        inputText: input.preparedAutomationRun.renderedInput,
      });

      return startedExecution.providerState === undefined
        ? {
            providerExecutionId: startedExecution.providerExecutionId,
          }
        : {
            providerExecutionId: startedExecution.providerExecutionId,
            providerState: startedExecution.providerState,
          };
    },
  );
}

export async function persistAutomationConversationExecution(
  deps: PersistAutomationConversationExecutionDependencies,
  input: PersistAutomationConversationExecutionServiceInput,
): Promise<void> {
  if (input.executedAutomationConversation.providerState === undefined) {
    await updateConversationExecution(
      {
        db: deps.db,
      },
      {
        routeId: input.boundAutomationConversation.routeId,
        providerExecutionId: input.executedAutomationConversation.providerExecutionId,
      },
    );
    return;
  }

  await updateConversationExecution(
    {
      db: deps.db,
    },
    {
      routeId: input.boundAutomationConversation.routeId,
      providerExecutionId: input.executedAutomationConversation.providerExecutionId,
      providerState: input.executedAutomationConversation.providerState,
    },
  );
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
  input: HandleAutomationRunMarkFailedServiceInput,
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
