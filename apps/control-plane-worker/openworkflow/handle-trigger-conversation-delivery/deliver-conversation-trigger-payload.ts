import type { ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import type { DataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import {
  TriggerConversationDeliveryTaskStatuses,
  type ControlPlaneDatabase,
} from "@mistle/db/control-plane";

import { activateTriggerConversationRoute } from "../shared/activate-conversation-route.js";
import { createTriggerConversationRoute } from "../shared/create-conversation-route.js";
import { markTriggerConversationDeliveryTaskDelivering } from "../shared/mark-conversation-delivery-task-delivering.js";
import {
  TriggerConversationPersistenceError,
  TriggerConversationPersistenceErrorCodes,
} from "../shared/trigger-conversation-persistence-error.js";
import type { EnsuredTriggerSandbox, PreparedTriggerRun } from "../shared/trigger-run-types.js";
import { updateTriggerConversationExecution } from "../shared/update-conversation-execution.js";
import {
  TriggerConversationRouteBindingActions,
  resolveTriggerConversationRouteBindingAction,
} from "./conversation-delivery-planning.js";
import { executeConversationProviderDelivery } from "./execute-conversation-provider-delivery.js";
import { seedSandboxInstanceTitle } from "./seed-sandbox-instance-title.js";
import {
  logTriggerConversationDeliveryEvent,
  withTriggerConversationDeliverySpan,
} from "./telemetry.js";
import type {
  AcquiredTriggerConnection,
  ExecuteConversationProviderDeliveryInput,
  ResolvedTriggerConversationDeliveryRoute,
} from "./types.js";

type TriggerConversationDeliveryRoute = Awaited<ReturnType<typeof createTriggerConversationRoute>>;
type TriggerConversationRouteBindingAction =
  (typeof TriggerConversationRouteBindingActions)[keyof typeof TriggerConversationRouteBindingActions];

export async function beginConversationTriggerPayloadDelivery(
  ctx: {
    db: ControlPlaneDatabase;
  },
  input: {
    taskId: string;
    generation: number;
  },
): Promise<void> {
  const task = await ctx.db.query.triggerConversationDeliveryTasks.findFirst({
    where: (table, { eq }) => eq(table.id, input.taskId),
  });
  if (task === undefined) {
    throw new TriggerConversationPersistenceError({
      code: TriggerConversationPersistenceErrorCodes.CONVERSATION_DELIVERY_TASK_NOT_FOUND,
      message: `TriggerConversation delivery task '${input.taskId}' was not found.`,
    });
  }

  if (task.processorGeneration !== input.generation) {
    throw new TriggerConversationPersistenceError({
      code: TriggerConversationPersistenceErrorCodes.CONVERSATION_DELIVERY_TASK_NOT_ACTIVE,
      message: `TriggerConversation delivery task '${input.taskId}' is not active for generation '${input.generation}'.`,
    });
  }

  if (task.status === TriggerConversationDeliveryTaskStatuses.DELIVERING) {
    throw new Error(
      `TriggerConversation delivery task '${input.taskId}' resumed after delivery started.`,
    );
  }

  if (task.status !== TriggerConversationDeliveryTaskStatuses.CLAIMED) {
    throw new TriggerConversationPersistenceError({
      code: TriggerConversationPersistenceErrorCodes.CONVERSATION_DELIVERY_TASK_NOT_CLAIMED,
      message: `TriggerConversation delivery task '${input.taskId}' is not claimed by generation '${input.generation}'.`,
    });
  }

  await markTriggerConversationDeliveryTaskDelivering(
    {
      db: ctx.db,
    },
    {
      taskId: input.taskId,
      generation: input.generation,
    },
  );
}

export async function loadOrCreateTriggerConversationDeliveryRoute(
  ctx: {
    db: ControlPlaneDatabase;
  },
  input: {
    taskId: string;
    preparedTriggerRun: PreparedTriggerRun;
    resolvedTriggerConversationRoute: ResolvedTriggerConversationDeliveryRoute;
    ensuredTriggerSandbox: EnsuredTriggerSandbox;
    workflowRunId: string;
  },
) {
  const persistedRouteId = input.resolvedTriggerConversationRoute.routeId;
  const route =
    persistedRouteId === null
      ? await createTriggerConversationRoute(
          {
            db: ctx.db,
          },
          {
            conversationId: input.preparedTriggerRun.conversationId,
            sandboxInstanceId: input.ensuredTriggerSandbox.sandboxInstanceId,
          },
        )
      : await ctx.db.query.triggerConversationRoutes.findFirst({
          where: (table, { eq }) => eq(table.id, persistedRouteId),
        });

  if (route === undefined) {
    throw new TriggerConversationPersistenceError({
      code: TriggerConversationPersistenceErrorCodes.CONVERSATION_ROUTE_NOT_FOUND,
      message: `TriggerConversation route for conversation '${input.preparedTriggerRun.conversationId}' was not found.`,
    });
  }

  const routeBindingAction = resolveTriggerConversationRouteBindingAction({
    routeId: route.id,
    routeSandboxInstanceId: route.sandboxInstanceId,
    providerConversationId: route.providerConversationId,
    ensuredSandboxInstanceId: input.ensuredTriggerSandbox.sandboxInstanceId,
  });

  if (routeBindingAction === TriggerConversationRouteBindingActions.FAIL_SANDBOX_MISMATCH) {
    throw new Error(
      `TriggerConversation '${input.preparedTriggerRun.conversationId}' is bound to sandbox '${route.sandboxInstanceId}', but delivery acquired sandbox '${input.ensuredTriggerSandbox.sandboxInstanceId}'.`,
    );
  }

  logTriggerConversationDeliveryEvent({
    eventName: "delivery_task.delivering",
    message: "Delivering trigger conversation payload",
    telemetryContext: {
      triggerRunId: input.preparedTriggerRun.triggerRunId,
      conversationId: input.preparedTriggerRun.conversationId,
      deliveryTaskId: input.taskId,
      routeId: route.id,
      sandboxInstanceId: input.ensuredTriggerSandbox.sandboxInstanceId,
      webhookEventId: input.preparedTriggerRun.webhookEventId,
      workflowRunId: input.workflowRunId,
    },
    attributes: {
      "mistle.route.binding_action": routeBindingAction,
    },
  });

  return {
    activeRoute: route,
    routeBindingAction,
  };
}

export function createConversationProviderDeliveryInput(input: {
  taskId: string;
  preparedTriggerRun: PreparedTriggerRun;
  resolvedTriggerConversationRoute: ResolvedTriggerConversationDeliveryRoute;
  ensuredTriggerSandbox: EnsuredTriggerSandbox;
  acquiredTriggerConnection: AcquiredTriggerConnection;
  activeRoute: TriggerConversationDeliveryRoute;
}): ExecuteConversationProviderDeliveryInput {
  return {
    conversationId: input.preparedTriggerRun.conversationId,
    runtimeId: input.resolvedTriggerConversationRoute.runtimeId,
    connectionUrl: input.acquiredTriggerConnection.url,
    inputText: input.preparedTriggerRun.renderedInput,
    workingDirectory: input.preparedTriggerRun.workingDirectory,
    deliveryContext: {
      source: input.preparedTriggerRun.sourceKind,
      ...(input.preparedTriggerRun.sourceWebhookEventId === undefined
        ? {}
        : { webhookEventId: input.preparedTriggerRun.sourceWebhookEventId }),
      ...(input.preparedTriggerRun.sourceScheduledActionId === undefined
        ? {}
        : { scheduledActionId: input.preparedTriggerRun.sourceScheduledActionId }),
      deliveryTaskId: input.taskId,
      ...(input.preparedTriggerRun.webhookExternalDeliveryId === null ||
      input.preparedTriggerRun.webhookExternalDeliveryId === undefined
        ? {}
        : {
            externalDeliveryId: input.preparedTriggerRun.webhookExternalDeliveryId,
          }),
      triggerRunId: input.preparedTriggerRun.triggerRunId,
      conversationId: input.preparedTriggerRun.conversationId,
      sandboxInstanceId: input.ensuredTriggerSandbox.sandboxInstanceId,
      routeId: input.activeRoute.id,
    },
    ...(input.preparedTriggerRun.instructions === null ||
    input.preparedTriggerRun.collaborationModeSettings === null
      ? {}
      : {
          collaborationModeSettings: {
            developerInstructions:
              input.preparedTriggerRun.collaborationModeSettings.developerInstructions,
          },
        }),
    providerConversationId: input.activeRoute.providerConversationId,
    providerExecutionId: input.activeRoute.providerExecutionId,
  };
}

export async function persistConversationProviderDeliveryResult(
  ctx: {
    db: ControlPlaneDatabase;
  },
  input: {
    preparedTriggerRun: PreparedTriggerRun;
    ensuredTriggerSandbox: EnsuredTriggerSandbox;
    activeRoute: TriggerConversationDeliveryRoute;
    routeBindingAction: TriggerConversationRouteBindingAction;
    deliveryResult: {
      providerConversationId: string;
      providerExecutionId: string | null;
      providerState?: unknown;
    };
  },
): Promise<void> {
  if (
    input.activeRoute.providerConversationId !== null &&
    input.deliveryResult.providerConversationId !== input.activeRoute.providerConversationId
  ) {
    throw new Error(
      `TriggerConversation '${input.preparedTriggerRun.conversationId}' changed provider conversation from '${input.activeRoute.providerConversationId}' to '${input.deliveryResult.providerConversationId}' during delivery.`,
    );
  }

  if (input.routeBindingAction !== TriggerConversationRouteBindingActions.REUSE_ACTIVE_ROUTE) {
    await activateTriggerConversationRoute(
      {
        db: ctx.db,
      },
      {
        conversationId: input.preparedTriggerRun.conversationId,
        routeId: input.activeRoute.id,
        sandboxInstanceId: input.ensuredTriggerSandbox.sandboxInstanceId,
        providerConversationId: input.deliveryResult.providerConversationId,
        providerState: input.deliveryResult.providerState,
      },
    );
  }

  await updateTriggerConversationExecution(
    {
      db: ctx.db,
    },
    {
      routeId: input.activeRoute.id,
      providerExecutionId: input.deliveryResult.providerExecutionId,
      providerState: input.deliveryResult.providerState,
    },
  );
}

export async function seedDeliveredSandboxInstanceTitle(
  ctx: {
    controlPlaneInternalClient: Pick<ControlPlaneInternalClient, "mintSandboxConnectionToken">;
    dataPlaneClient: Pick<
      DataPlaneSandboxInstancesClient,
      "getSandboxInstance" | "patchSandboxInstanceTitle"
    >;
  },
  input: {
    taskId: string;
    preparedTriggerRun: PreparedTriggerRun;
    resolvedTriggerConversationRoute: ResolvedTriggerConversationDeliveryRoute;
    ensuredTriggerSandbox: EnsuredTriggerSandbox;
    activeRoute: TriggerConversationDeliveryRoute;
    deliveryResult: {
      providerConversationId: string;
      providerState?: unknown;
    };
    workflowRunId: string;
  },
): Promise<void> {
  try {
    const titleSeedResult = await seedSandboxInstanceTitle(
      {
        dataPlaneClient: ctx.dataPlaneClient,
      },
      {
        organizationId: input.preparedTriggerRun.organizationId,
        sandboxInstanceId: input.ensuredTriggerSandbox.sandboxInstanceId,
        runtimeId: input.resolvedTriggerConversationRoute.runtimeId,
        getConnectionUrl: async () =>
          await mintSandboxTitleConnectionUrl(ctx, {
            preparedTriggerRun: input.preparedTriggerRun,
            sandboxInstanceId: input.ensuredTriggerSandbox.sandboxInstanceId,
            deliveryTaskId: input.taskId,
            workflowRunId: input.workflowRunId,
          }),
        providerConversationId: input.deliveryResult.providerConversationId,
        providerState: input.deliveryResult.providerState,
        inputText: input.preparedTriggerRun.renderedInput,
      },
    );
    if (titleSeedResult === "unsupported") {
      logTriggerConversationDeliveryEvent({
        eventName: "sandbox_title.generation_unsupported",
        message: "Trigger sandbox title generation skipped because runtime has no title capability",
        telemetryContext: {
          triggerRunId: input.preparedTriggerRun.triggerRunId,
          conversationId: input.preparedTriggerRun.conversationId,
          deliveryTaskId: input.taskId,
          routeId: input.activeRoute.id,
          sandboxInstanceId: input.ensuredTriggerSandbox.sandboxInstanceId,
          webhookEventId: input.preparedTriggerRun.webhookEventId,
          workflowRunId: input.workflowRunId,
        },
        attributes: {
          "mistle.runtime.id": input.resolvedTriggerConversationRoute.runtimeId,
        },
      });
    }
  } catch (error) {
    logTriggerConversationDeliveryEvent({
      eventName: "sandbox_title.seed_failed",
      message: "Failed to seed trigger sandbox title after delivery",
      level: "warn",
      err: error,
      telemetryContext: {
        triggerRunId: input.preparedTriggerRun.triggerRunId,
        conversationId: input.preparedTriggerRun.conversationId,
        deliveryTaskId: input.taskId,
        routeId: input.activeRoute.id,
        sandboxInstanceId: input.ensuredTriggerSandbox.sandboxInstanceId,
        webhookEventId: input.preparedTriggerRun.webhookEventId,
        workflowRunId: input.workflowRunId,
      },
    });
  }
}

export async function deliverConversationTriggerPayload(
  ctx: {
    controlPlaneInternalClient: Pick<ControlPlaneInternalClient, "mintSandboxConnectionToken">;
    db: ControlPlaneDatabase;
    dataPlaneClient: Pick<
      DataPlaneSandboxInstancesClient,
      "getSandboxInstance" | "patchSandboxInstanceTitle"
    >;
  },
  input: {
    taskId: string;
    generation: number;
    preparedTriggerRun: PreparedTriggerRun;
    resolvedTriggerConversationRoute: ResolvedTriggerConversationDeliveryRoute;
    ensuredTriggerSandbox: EnsuredTriggerSandbox;
    acquiredTriggerConnection: AcquiredTriggerConnection;
    workflowRunId: string;
  },
): Promise<void> {
  const task = await ctx.db.query.triggerConversationDeliveryTasks.findFirst({
    where: (table, { eq }) => eq(table.id, input.taskId),
  });
  if (task === undefined) {
    throw new TriggerConversationPersistenceError({
      code: TriggerConversationPersistenceErrorCodes.CONVERSATION_DELIVERY_TASK_NOT_FOUND,
      message: `TriggerConversation delivery task '${input.taskId}' was not found.`,
    });
  }

  if (task.processorGeneration !== input.generation) {
    throw new TriggerConversationPersistenceError({
      code: TriggerConversationPersistenceErrorCodes.CONVERSATION_DELIVERY_TASK_NOT_ACTIVE,
      message: `TriggerConversation delivery task '${input.taskId}' is not active for generation '${input.generation}'.`,
    });
  }

  if (task.status === TriggerConversationDeliveryTaskStatuses.DELIVERING) {
    throw new Error(
      `TriggerConversation delivery task '${input.taskId}' resumed after delivery started.`,
    );
  }

  if (task.status !== TriggerConversationDeliveryTaskStatuses.CLAIMED) {
    throw new TriggerConversationPersistenceError({
      code: TriggerConversationPersistenceErrorCodes.CONVERSATION_DELIVERY_TASK_NOT_CLAIMED,
      message: `TriggerConversation delivery task '${input.taskId}' is not claimed by generation '${input.generation}'.`,
    });
  }

  await markTriggerConversationDeliveryTaskDelivering(
    {
      db: ctx.db,
    },
    {
      taskId: input.taskId,
      generation: input.generation,
    },
  );

  const persistedRouteId = input.resolvedTriggerConversationRoute.routeId;
  let route: Awaited<ReturnType<typeof createTriggerConversationRoute>> | undefined;
  if (persistedRouteId === null) {
    route = await createTriggerConversationRoute(
      {
        db: ctx.db,
      },
      {
        conversationId: input.preparedTriggerRun.conversationId,
        sandboxInstanceId: input.ensuredTriggerSandbox.sandboxInstanceId,
      },
    );
  } else {
    route = await ctx.db.query.triggerConversationRoutes.findFirst({
      where: (table, { eq }) => eq(table.id, persistedRouteId),
    });
  }

  if (route === undefined) {
    throw new TriggerConversationPersistenceError({
      code: TriggerConversationPersistenceErrorCodes.CONVERSATION_ROUTE_NOT_FOUND,
      message: `TriggerConversation route for conversation '${input.preparedTriggerRun.conversationId}' was not found.`,
    });
  }
  const activeRoute = route;

  const routeBindingAction = resolveTriggerConversationRouteBindingAction({
    routeId: activeRoute.id,
    routeSandboxInstanceId: activeRoute.sandboxInstanceId,
    providerConversationId: activeRoute.providerConversationId,
    ensuredSandboxInstanceId: input.ensuredTriggerSandbox.sandboxInstanceId,
  });

  if (routeBindingAction === TriggerConversationRouteBindingActions.FAIL_SANDBOX_MISMATCH) {
    throw new Error(
      `TriggerConversation '${input.preparedTriggerRun.conversationId}' is bound to sandbox '${activeRoute.sandboxInstanceId}', but delivery acquired sandbox '${input.ensuredTriggerSandbox.sandboxInstanceId}'.`,
    );
  }

  logTriggerConversationDeliveryEvent({
    eventName: "delivery_task.delivering",
    message: "Delivering trigger conversation payload",
    telemetryContext: {
      triggerRunId: input.preparedTriggerRun.triggerRunId,
      conversationId: input.preparedTriggerRun.conversationId,
      deliveryTaskId: input.taskId,
      routeId: activeRoute.id,
      sandboxInstanceId: input.ensuredTriggerSandbox.sandboxInstanceId,
      webhookEventId: input.preparedTriggerRun.webhookEventId,
      workflowRunId: input.workflowRunId,
    },
    attributes: {
      "mistle.route.binding_action": routeBindingAction,
    },
  });

  const deliveryResult = await withTriggerConversationDeliverySpan(
    {
      name: "trigger_conversation_delivery.provider.execute",
      telemetryContext: {
        triggerRunId: input.preparedTriggerRun.triggerRunId,
        conversationId: input.preparedTriggerRun.conversationId,
        deliveryTaskId: input.taskId,
        routeId: activeRoute.id,
        sandboxInstanceId: input.ensuredTriggerSandbox.sandboxInstanceId,
        webhookEventId: input.preparedTriggerRun.webhookEventId,
        workflowRunId: input.workflowRunId,
      },
    },
    async (span) => {
      span.setAttribute("mistle.route.binding_action", routeBindingAction);

      const deliveryStartedAt = Date.now();
      const result = await executeConversationProviderDelivery({
        conversationId: input.preparedTriggerRun.conversationId,
        runtimeId: input.resolvedTriggerConversationRoute.runtimeId,
        connectionUrl: input.acquiredTriggerConnection.url,
        inputText: input.preparedTriggerRun.renderedInput,
        workingDirectory: input.preparedTriggerRun.workingDirectory,
        deliveryContext: {
          source: input.preparedTriggerRun.sourceKind,
          ...(input.preparedTriggerRun.sourceWebhookEventId === undefined
            ? {}
            : { webhookEventId: input.preparedTriggerRun.sourceWebhookEventId }),
          ...(input.preparedTriggerRun.sourceScheduledActionId === undefined
            ? {}
            : { scheduledActionId: input.preparedTriggerRun.sourceScheduledActionId }),
          deliveryTaskId: input.taskId,
          ...(input.preparedTriggerRun.webhookExternalDeliveryId === null ||
          input.preparedTriggerRun.webhookExternalDeliveryId === undefined
            ? {}
            : {
                externalDeliveryId: input.preparedTriggerRun.webhookExternalDeliveryId,
              }),
          triggerRunId: input.preparedTriggerRun.triggerRunId,
          conversationId: input.preparedTriggerRun.conversationId,
          sandboxInstanceId: input.ensuredTriggerSandbox.sandboxInstanceId,
          routeId: activeRoute.id,
        },
        ...(input.preparedTriggerRun.instructions === null ||
        input.preparedTriggerRun.collaborationModeSettings === null
          ? {}
          : {
              collaborationModeSettings: {
                developerInstructions:
                  input.preparedTriggerRun.collaborationModeSettings.developerInstructions,
              },
            }),
        providerConversationId: activeRoute.providerConversationId,
        providerExecutionId: activeRoute.providerExecutionId,
      });
      const deliveryDurationMs = Date.now() - deliveryStartedAt;

      span.setAttributes({
        "mistle.provider.execute_ms": deliveryDurationMs,
        "mistle.provider.conversation_id": result.providerConversationId,
        ...(result.providerExecutionId === null
          ? {}
          : { "mistle.provider.execution_id": result.providerExecutionId }),
      });

      return result;
    },
  );

  if (
    activeRoute.providerConversationId !== null &&
    deliveryResult.providerConversationId !== activeRoute.providerConversationId
  ) {
    throw new Error(
      `TriggerConversation '${input.preparedTriggerRun.conversationId}' changed provider conversation from '${activeRoute.providerConversationId}' to '${deliveryResult.providerConversationId}' during delivery.`,
    );
  }

  if (routeBindingAction !== TriggerConversationRouteBindingActions.REUSE_ACTIVE_ROUTE) {
    route = await activateTriggerConversationRoute(
      {
        db: ctx.db,
      },
      {
        conversationId: input.preparedTriggerRun.conversationId,
        routeId: activeRoute.id,
        sandboxInstanceId: input.ensuredTriggerSandbox.sandboxInstanceId,
        providerConversationId: deliveryResult.providerConversationId,
        providerState: deliveryResult.providerState,
      },
    );
  }

  await updateTriggerConversationExecution(
    {
      db: ctx.db,
    },
    {
      routeId: activeRoute.id,
      providerExecutionId: deliveryResult.providerExecutionId,
      providerState: deliveryResult.providerState,
    },
  );

  try {
    const titleSeedResult = await seedSandboxInstanceTitle(
      {
        dataPlaneClient: ctx.dataPlaneClient,
      },
      {
        organizationId: input.preparedTriggerRun.organizationId,
        sandboxInstanceId: input.ensuredTriggerSandbox.sandboxInstanceId,
        runtimeId: input.resolvedTriggerConversationRoute.runtimeId,
        getConnectionUrl: async () =>
          await mintSandboxTitleConnectionUrl(ctx, {
            preparedTriggerRun: input.preparedTriggerRun,
            sandboxInstanceId: input.ensuredTriggerSandbox.sandboxInstanceId,
            deliveryTaskId: input.taskId,
            workflowRunId: input.workflowRunId,
          }),
        providerConversationId: deliveryResult.providerConversationId,
        providerState: deliveryResult.providerState,
        inputText: input.preparedTriggerRun.renderedInput,
      },
    );
    if (titleSeedResult === "unsupported") {
      logTriggerConversationDeliveryEvent({
        eventName: "sandbox_title.generation_unsupported",
        message: "Trigger sandbox title generation skipped because runtime has no title capability",
        telemetryContext: {
          triggerRunId: input.preparedTriggerRun.triggerRunId,
          conversationId: input.preparedTriggerRun.conversationId,
          deliveryTaskId: input.taskId,
          routeId: activeRoute.id,
          sandboxInstanceId: input.ensuredTriggerSandbox.sandboxInstanceId,
          webhookEventId: input.preparedTriggerRun.webhookEventId,
          workflowRunId: input.workflowRunId,
        },
        attributes: {
          "mistle.runtime.id": input.resolvedTriggerConversationRoute.runtimeId,
        },
      });
    }
  } catch (error) {
    logTriggerConversationDeliveryEvent({
      eventName: "sandbox_title.seed_failed",
      message: "Failed to seed trigger sandbox title after delivery",
      level: "warn",
      err: error,
      telemetryContext: {
        triggerRunId: input.preparedTriggerRun.triggerRunId,
        conversationId: input.preparedTriggerRun.conversationId,
        deliveryTaskId: input.taskId,
        routeId: activeRoute.id,
        sandboxInstanceId: input.ensuredTriggerSandbox.sandboxInstanceId,
        webhookEventId: input.preparedTriggerRun.webhookEventId,
        workflowRunId: input.workflowRunId,
      },
    });
  }
}

async function mintSandboxTitleConnectionUrl(
  ctx: {
    controlPlaneInternalClient: Pick<ControlPlaneInternalClient, "mintSandboxConnectionToken">;
  },
  input: {
    preparedTriggerRun: PreparedTriggerRun;
    sandboxInstanceId: string;
    deliveryTaskId: string;
    workflowRunId: string;
  },
): Promise<string> {
  const mintStartedAt = Date.now();
  logTriggerConversationDeliveryEvent({
    eventName: "sandbox_title.connection_token.mint_started",
    message: "Minting sandbox connection token for trigger title generation",
    telemetryContext: {
      triggerRunId: input.preparedTriggerRun.triggerRunId,
      conversationId: input.preparedTriggerRun.conversationId,
      deliveryTaskId: input.deliveryTaskId,
      sandboxInstanceId: input.sandboxInstanceId,
      webhookEventId: input.preparedTriggerRun.webhookEventId,
      workflowRunId: input.workflowRunId,
    },
  });

  try {
    const connection = await ctx.controlPlaneInternalClient.mintSandboxConnectionToken({
      organizationId: input.preparedTriggerRun.organizationId,
      instanceId: input.sandboxInstanceId,
      ...(input.preparedTriggerRun.actingUserId === undefined
        ? {}
        : { actingUserId: input.preparedTriggerRun.actingUserId }),
      ...(input.preparedTriggerRun.webhookEventId === undefined
        ? {}
        : { webhookEventId: input.preparedTriggerRun.webhookEventId }),
      deliveryTaskId: input.deliveryTaskId,
      triggerRunId: input.preparedTriggerRun.triggerRunId,
      conversationId: input.preparedTriggerRun.conversationId,
      ...(input.preparedTriggerRun.webhookExternalDeliveryId === null ||
      input.preparedTriggerRun.webhookExternalDeliveryId === undefined
        ? {}
        : {
            externalDeliveryId: input.preparedTriggerRun.webhookExternalDeliveryId,
          }),
    });
    const mintDurationMs = Date.now() - mintStartedAt;
    logTriggerConversationDeliveryEvent({
      eventName: "sandbox_title.connection_token.minted",
      message: "Minted sandbox connection token for trigger title generation",
      telemetryContext: {
        triggerRunId: input.preparedTriggerRun.triggerRunId,
        conversationId: input.preparedTriggerRun.conversationId,
        deliveryTaskId: input.deliveryTaskId,
        sandboxInstanceId: input.sandboxInstanceId,
        webhookEventId: input.preparedTriggerRun.webhookEventId,
        workflowRunId: input.workflowRunId,
      },
      attributes: {
        "mistle.connection.mint_ms": mintDurationMs,
        "mistle.connection.token_jti": connection.tokenJti,
      },
    });

    return connection.url;
  } catch (error) {
    logTriggerConversationDeliveryEvent({
      eventName: "sandbox_title.connection_token.failed",
      message: "Failed to mint sandbox connection token for trigger title generation",
      telemetryContext: {
        triggerRunId: input.preparedTriggerRun.triggerRunId,
        conversationId: input.preparedTriggerRun.conversationId,
        deliveryTaskId: input.deliveryTaskId,
        sandboxInstanceId: input.sandboxInstanceId,
        webhookEventId: input.preparedTriggerRun.webhookEventId,
        workflowRunId: input.workflowRunId,
      },
      err: error,
      level: "error",
    });
    throw error;
  }
}
