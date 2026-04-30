import type { ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import type { DataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import {
  AutomationConversationDeliveryTaskStatuses,
  type ControlPlaneDatabase,
} from "@mistle/db/control-plane";

import { activateAutomationConversationRoute } from "../shared/activate-conversation-route.js";
import {
  AutomationConversationPersistenceError,
  AutomationConversationPersistenceErrorCodes,
} from "../shared/automation-conversation-persistence-error.js";
import type {
  EnsuredAutomationSandbox,
  PreparedAutomationRun,
} from "../shared/automation-run-types.js";
import { createAutomationConversationRoute } from "../shared/create-conversation-route.js";
import { markAutomationConversationDeliveryTaskDelivering } from "../shared/mark-conversation-delivery-task-delivering.js";
import { updateAutomationConversationExecution } from "../shared/update-conversation-execution.js";
import {
  AutomationConversationRouteBindingActions,
  resolveAutomationConversationRouteBindingAction,
} from "./conversation-delivery-planning.js";
import { executeConversationProviderDelivery } from "./execute-conversation-provider-delivery.js";
import { seedSandboxInstanceTitle } from "./seed-sandbox-instance-title.js";
import {
  logAutomationConversationDeliveryEvent,
  withAutomationConversationDeliverySpan,
} from "./telemetry.js";
import type {
  AcquiredAutomationConnection,
  ResolvedAutomationConversationDeliveryRoute,
} from "./types.js";

export async function deliverConversationAutomationPayload(
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
    preparedAutomationRun: PreparedAutomationRun;
    resolvedAutomationConversationRoute: ResolvedAutomationConversationDeliveryRoute;
    ensuredAutomationSandbox: EnsuredAutomationSandbox;
    acquiredAutomationConnection: AcquiredAutomationConnection;
    workflowRunId: string;
  },
): Promise<void> {
  const task = await ctx.db.query.automationConversationDeliveryTasks.findFirst({
    where: (table, { eq }) => eq(table.id, input.taskId),
  });
  if (task === undefined) {
    throw new AutomationConversationPersistenceError({
      code: AutomationConversationPersistenceErrorCodes.CONVERSATION_DELIVERY_TASK_NOT_FOUND,
      message: `AutomationConversation delivery task '${input.taskId}' was not found.`,
    });
  }

  if (task.processorGeneration !== input.generation) {
    throw new AutomationConversationPersistenceError({
      code: AutomationConversationPersistenceErrorCodes.CONVERSATION_DELIVERY_TASK_NOT_ACTIVE,
      message: `AutomationConversation delivery task '${input.taskId}' is not active for generation '${input.generation}'.`,
    });
  }

  if (task.status === AutomationConversationDeliveryTaskStatuses.DELIVERING) {
    throw new Error(
      `AutomationConversation delivery task '${input.taskId}' resumed after delivery started.`,
    );
  }

  if (task.status !== AutomationConversationDeliveryTaskStatuses.CLAIMED) {
    throw new AutomationConversationPersistenceError({
      code: AutomationConversationPersistenceErrorCodes.CONVERSATION_DELIVERY_TASK_NOT_CLAIMED,
      message: `AutomationConversation delivery task '${input.taskId}' is not claimed by generation '${input.generation}'.`,
    });
  }

  await markAutomationConversationDeliveryTaskDelivering(
    {
      db: ctx.db,
    },
    {
      taskId: input.taskId,
      generation: input.generation,
    },
  );

  const persistedRouteId = input.resolvedAutomationConversationRoute.routeId;
  let route: Awaited<ReturnType<typeof createAutomationConversationRoute>> | undefined;
  if (persistedRouteId === null) {
    route = await createAutomationConversationRoute(
      {
        db: ctx.db,
      },
      {
        conversationId: input.preparedAutomationRun.conversationId,
        sandboxInstanceId: input.ensuredAutomationSandbox.sandboxInstanceId,
      },
    );
  } else {
    route = await ctx.db.query.automationConversationRoutes.findFirst({
      where: (table, { eq }) => eq(table.id, persistedRouteId),
    });
  }

  if (route === undefined) {
    throw new AutomationConversationPersistenceError({
      code: AutomationConversationPersistenceErrorCodes.CONVERSATION_ROUTE_NOT_FOUND,
      message: `AutomationConversation route for conversation '${input.preparedAutomationRun.conversationId}' was not found.`,
    });
  }
  const activeRoute = route;

  const routeBindingAction = resolveAutomationConversationRouteBindingAction({
    routeId: activeRoute.id,
    routeSandboxInstanceId: activeRoute.sandboxInstanceId,
    providerConversationId: activeRoute.providerConversationId,
    ensuredSandboxInstanceId: input.ensuredAutomationSandbox.sandboxInstanceId,
  });

  if (routeBindingAction === AutomationConversationRouteBindingActions.FAIL_SANDBOX_MISMATCH) {
    throw new Error(
      `AutomationConversation '${input.preparedAutomationRun.conversationId}' is bound to sandbox '${activeRoute.sandboxInstanceId}', but delivery acquired sandbox '${input.ensuredAutomationSandbox.sandboxInstanceId}'.`,
    );
  }

  logAutomationConversationDeliveryEvent({
    eventName: "delivery_task.delivering",
    message: "Delivering automation conversation payload",
    telemetryContext: {
      automationRunId: input.preparedAutomationRun.automationRunId,
      conversationId: input.preparedAutomationRun.conversationId,
      deliveryTaskId: input.taskId,
      routeId: activeRoute.id,
      sandboxInstanceId: input.ensuredAutomationSandbox.sandboxInstanceId,
      webhookEventId: input.preparedAutomationRun.webhookEventId,
      workflowRunId: input.workflowRunId,
    },
    attributes: {
      "mistle.route.binding_action": routeBindingAction,
    },
  });

  const deliveryResult = await withAutomationConversationDeliverySpan(
    {
      name: "automation_conversation_delivery.provider.execute",
      telemetryContext: {
        automationRunId: input.preparedAutomationRun.automationRunId,
        conversationId: input.preparedAutomationRun.conversationId,
        deliveryTaskId: input.taskId,
        routeId: activeRoute.id,
        sandboxInstanceId: input.ensuredAutomationSandbox.sandboxInstanceId,
        webhookEventId: input.preparedAutomationRun.webhookEventId,
        workflowRunId: input.workflowRunId,
      },
    },
    async (span) => {
      span.setAttribute("mistle.route.binding_action", routeBindingAction);

      const deliveryStartedAt = Date.now();
      const result = await executeConversationProviderDelivery({
        conversationId: input.preparedAutomationRun.conversationId,
        runtimeId: input.resolvedAutomationConversationRoute.runtimeId,
        connectionUrl: input.acquiredAutomationConnection.url,
        inputText: input.preparedAutomationRun.renderedInput,
        deliveryContext: {
          source: input.preparedAutomationRun.sourceKind,
          ...(input.preparedAutomationRun.sourceWebhookEventId === undefined
            ? {}
            : { webhookEventId: input.preparedAutomationRun.sourceWebhookEventId }),
          ...(input.preparedAutomationRun.sourceScheduledActionId === undefined
            ? {}
            : { scheduledActionId: input.preparedAutomationRun.sourceScheduledActionId }),
          deliveryTaskId: input.taskId,
          ...(input.preparedAutomationRun.webhookExternalDeliveryId === null ||
          input.preparedAutomationRun.webhookExternalDeliveryId === undefined
            ? {}
            : {
                externalDeliveryId: input.preparedAutomationRun.webhookExternalDeliveryId,
              }),
          automationRunId: input.preparedAutomationRun.automationRunId,
          conversationId: input.preparedAutomationRun.conversationId,
          sandboxInstanceId: input.ensuredAutomationSandbox.sandboxInstanceId,
          routeId: activeRoute.id,
        },
        ...(input.preparedAutomationRun.instructions === null ||
        input.preparedAutomationRun.collaborationModeSettings === null
          ? {}
          : {
              collaborationModeSettings: {
                developerInstructions:
                  input.preparedAutomationRun.collaborationModeSettings.developerInstructions,
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
      `AutomationConversation '${input.preparedAutomationRun.conversationId}' changed provider conversation from '${activeRoute.providerConversationId}' to '${deliveryResult.providerConversationId}' during delivery.`,
    );
  }

  if (routeBindingAction !== AutomationConversationRouteBindingActions.REUSE_ACTIVE_ROUTE) {
    route = await activateAutomationConversationRoute(
      {
        db: ctx.db,
      },
      {
        conversationId: input.preparedAutomationRun.conversationId,
        routeId: activeRoute.id,
        sandboxInstanceId: input.ensuredAutomationSandbox.sandboxInstanceId,
        providerConversationId: deliveryResult.providerConversationId,
        providerState: deliveryResult.providerState,
      },
    );
  }

  await updateAutomationConversationExecution(
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
        organizationId: input.preparedAutomationRun.organizationId,
        sandboxInstanceId: input.ensuredAutomationSandbox.sandboxInstanceId,
        runtimeId: input.resolvedAutomationConversationRoute.runtimeId,
        getConnectionUrl: async () =>
          await mintSandboxTitleConnectionUrl(ctx, {
            preparedAutomationRun: input.preparedAutomationRun,
            sandboxInstanceId: input.ensuredAutomationSandbox.sandboxInstanceId,
            deliveryTaskId: input.taskId,
            workflowRunId: input.workflowRunId,
          }),
        providerConversationId: deliveryResult.providerConversationId,
        inputText: input.preparedAutomationRun.renderedInput,
      },
    );
    if (titleSeedResult === "unsupported") {
      logAutomationConversationDeliveryEvent({
        eventName: "sandbox_title.generation_unsupported",
        message:
          "Automation sandbox title generation skipped because runtime has no title capability",
        telemetryContext: {
          automationRunId: input.preparedAutomationRun.automationRunId,
          conversationId: input.preparedAutomationRun.conversationId,
          deliveryTaskId: input.taskId,
          routeId: activeRoute.id,
          sandboxInstanceId: input.ensuredAutomationSandbox.sandboxInstanceId,
          webhookEventId: input.preparedAutomationRun.webhookEventId,
          workflowRunId: input.workflowRunId,
        },
        attributes: {
          "mistle.runtime.id": input.resolvedAutomationConversationRoute.runtimeId,
        },
      });
    }
  } catch (error) {
    logAutomationConversationDeliveryEvent({
      eventName: "sandbox_title.seed_failed",
      message: "Failed to seed automation sandbox title after delivery",
      level: "warn",
      err: error,
      telemetryContext: {
        automationRunId: input.preparedAutomationRun.automationRunId,
        conversationId: input.preparedAutomationRun.conversationId,
        deliveryTaskId: input.taskId,
        routeId: activeRoute.id,
        sandboxInstanceId: input.ensuredAutomationSandbox.sandboxInstanceId,
        webhookEventId: input.preparedAutomationRun.webhookEventId,
        workflowRunId: input.workflowRunId,
      },
    });
    throw error;
  }
}

async function mintSandboxTitleConnectionUrl(
  ctx: {
    controlPlaneInternalClient: Pick<ControlPlaneInternalClient, "mintSandboxConnectionToken">;
  },
  input: {
    preparedAutomationRun: PreparedAutomationRun;
    sandboxInstanceId: string;
    deliveryTaskId: string;
    workflowRunId: string;
  },
): Promise<string> {
  const mintStartedAt = Date.now();
  logAutomationConversationDeliveryEvent({
    eventName: "sandbox_title.connection_token.mint_started",
    message: "Minting sandbox connection token for automation title generation",
    telemetryContext: {
      automationRunId: input.preparedAutomationRun.automationRunId,
      conversationId: input.preparedAutomationRun.conversationId,
      deliveryTaskId: input.deliveryTaskId,
      sandboxInstanceId: input.sandboxInstanceId,
      webhookEventId: input.preparedAutomationRun.webhookEventId,
      workflowRunId: input.workflowRunId,
    },
  });

  try {
    const connection = await ctx.controlPlaneInternalClient.mintSandboxConnectionToken({
      organizationId: input.preparedAutomationRun.organizationId,
      instanceId: input.sandboxInstanceId,
      ...(input.preparedAutomationRun.actingUserId === undefined
        ? {}
        : { actingUserId: input.preparedAutomationRun.actingUserId }),
      ...(input.preparedAutomationRun.webhookEventId === undefined
        ? {}
        : { webhookEventId: input.preparedAutomationRun.webhookEventId }),
      deliveryTaskId: input.deliveryTaskId,
      automationRunId: input.preparedAutomationRun.automationRunId,
      conversationId: input.preparedAutomationRun.conversationId,
      ...(input.preparedAutomationRun.webhookExternalDeliveryId === null ||
      input.preparedAutomationRun.webhookExternalDeliveryId === undefined
        ? {}
        : {
            externalDeliveryId: input.preparedAutomationRun.webhookExternalDeliveryId,
          }),
    });
    const mintDurationMs = Date.now() - mintStartedAt;
    logAutomationConversationDeliveryEvent({
      eventName: "sandbox_title.connection_token.minted",
      message: "Minted sandbox connection token for automation title generation",
      telemetryContext: {
        automationRunId: input.preparedAutomationRun.automationRunId,
        conversationId: input.preparedAutomationRun.conversationId,
        deliveryTaskId: input.deliveryTaskId,
        sandboxInstanceId: input.sandboxInstanceId,
        webhookEventId: input.preparedAutomationRun.webhookEventId,
        workflowRunId: input.workflowRunId,
      },
      attributes: {
        "mistle.connection.mint_ms": mintDurationMs,
        "mistle.connection.token_jti": connection.tokenJti,
      },
    });

    return connection.url;
  } catch (error) {
    logAutomationConversationDeliveryEvent({
      eventName: "sandbox_title.connection_token.failed",
      message: "Failed to mint sandbox connection token for automation title generation",
      telemetryContext: {
        automationRunId: input.preparedAutomationRun.automationRunId,
        conversationId: input.preparedAutomationRun.conversationId,
        deliveryTaskId: input.deliveryTaskId,
        sandboxInstanceId: input.sandboxInstanceId,
        webhookEventId: input.preparedAutomationRun.webhookEventId,
        workflowRunId: input.workflowRunId,
      },
      err: error,
      level: "error",
    });
    throw error;
  }
}
