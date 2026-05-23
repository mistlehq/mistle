import type { ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import type { ControlPlaneDatabase } from "@mistle/db/control-plane";

import { recoverTriggerConversationSandbox } from "../shared/recover-conversation-sandbox.js";
import type { EnsuredTriggerSandbox, PreparedTriggerRun } from "../shared/trigger-run-types.js";
import { ensureTriggerSandbox } from "../shared/trigger-run.js";
import {
  type ConversationDeliverySandboxAction,
  TriggerConversationDeliverySandboxActions,
  resolveTriggerConversationDeliverySandboxAction,
} from "./conversation-delivery-planning.js";
import {
  logTriggerConversationDeliveryEvent,
  withTriggerConversationDeliverySpan,
} from "./telemetry.js";
import type { ResolvedTriggerConversationDeliveryRoute } from "./types.js";

export async function ensureConversationDeliverySandbox(
  ctx: {
    db: ControlPlaneDatabase;
    controlPlaneInternalClient: ControlPlaneInternalClient;
  },
  input: {
    deliveryTaskId: string;
    preparedTriggerRun: PreparedTriggerRun;
    resolvedTriggerConversationRoute: ResolvedTriggerConversationDeliveryRoute;
    workflowRunId: string;
  },
): Promise<EnsuredTriggerSandbox> {
  return await withTriggerConversationDeliverySpan(
    {
      name: "trigger_conversation_delivery.sandbox.ensure",
      telemetryContext: {
        triggerRunId: input.preparedTriggerRun.triggerRunId,
        conversationId: input.preparedTriggerRun.conversationId,
        deliveryTaskId: input.deliveryTaskId,
        routeId: input.resolvedTriggerConversationRoute.routeId ?? undefined,
        sandboxInstanceId: input.resolvedTriggerConversationRoute.sandboxInstanceId ?? undefined,
        webhookEventId: input.preparedTriggerRun.webhookEventId,
        workflowRunId: input.workflowRunId,
      },
    },
    async (span) => {
      let sandboxAction: ConversationDeliverySandboxAction | null = null;
      if (input.resolvedTriggerConversationRoute.sandboxInstanceId !== null) {
        const existingSandbox = await ctx.controlPlaneInternalClient.getSandboxInstance({
          organizationId: input.preparedTriggerRun.organizationId,
          instanceId: input.resolvedTriggerConversationRoute.sandboxInstanceId,
        });

        sandboxAction = resolveTriggerConversationDeliverySandboxAction({
          sandboxInstanceId: input.resolvedTriggerConversationRoute.sandboxInstanceId,
          sandboxStatus: existingSandbox.status,
        });

        span.setAttributes({
          "mistle.sandbox.decision": sandboxAction,
          "mistle.sandbox.status": existingSandbox.status,
        });

        if (sandboxAction === TriggerConversationDeliverySandboxActions.REUSE_EXISTING) {
          logTriggerConversationDeliveryEvent({
            eventName: "sandbox.reused",
            message: "Reusing trigger conversation sandbox",
            telemetryContext: {
              triggerRunId: input.preparedTriggerRun.triggerRunId,
              conversationId: input.preparedTriggerRun.conversationId,
              deliveryTaskId: input.deliveryTaskId,
              routeId: input.resolvedTriggerConversationRoute.routeId ?? undefined,
              sandboxInstanceId: existingSandbox.id,
              webhookEventId: input.preparedTriggerRun.webhookEventId,
              workflowRunId: input.workflowRunId,
            },
            attributes: {
              "mistle.sandbox.status": existingSandbox.status,
            },
          });

          return {
            sandboxInstanceId: existingSandbox.id,
            startupWorkflowRunId: null,
          };
        }

        if (sandboxAction === TriggerConversationDeliverySandboxActions.FAIL) {
          throw new Error(
            `TriggerConversation '${input.preparedTriggerRun.conversationId}' is bound to sandbox '${input.resolvedTriggerConversationRoute.sandboxInstanceId}', but that sandbox is '${existingSandbox.status}'.`,
          );
        }
      }

      span.setAttribute(
        "mistle.sandbox.decision",
        TriggerConversationDeliverySandboxActions.START_NEW,
      );

      const ensuredSandbox = await ensureTriggerSandbox(
        {
          db: ctx.db,
          controlPlaneInternalClient: ctx.controlPlaneInternalClient,
        },
        {
          preparedTriggerRun: input.preparedTriggerRun,
        },
      );
      span.setAttribute("mistle.sandbox.instance_id", ensuredSandbox.sandboxInstanceId);

      if (
        sandboxAction === TriggerConversationDeliverySandboxActions.RECOVER_FAILED &&
        input.resolvedTriggerConversationRoute.routeId !== null &&
        input.resolvedTriggerConversationRoute.sandboxInstanceId !== null
      ) {
        await recoverTriggerConversationSandbox(
          {
            db: ctx.db,
          },
          {
            routeId: input.resolvedTriggerConversationRoute.routeId,
            sandboxInstanceId: ensuredSandbox.sandboxInstanceId,
          },
        );
        logTriggerConversationDeliveryEvent({
          eventName: "sandbox.recovered",
          message: "Rebound trigger conversation route from failed sandbox to replacement sandbox",
          telemetryContext: {
            triggerRunId: input.preparedTriggerRun.triggerRunId,
            conversationId: input.preparedTriggerRun.conversationId,
            deliveryTaskId: input.deliveryTaskId,
            routeId: input.resolvedTriggerConversationRoute.routeId,
            sandboxInstanceId: ensuredSandbox.sandboxInstanceId,
            webhookEventId: input.preparedTriggerRun.webhookEventId,
            workflowRunId: input.workflowRunId,
          },
          attributes: {
            "mistle.sandbox.previous_instance_id":
              input.resolvedTriggerConversationRoute.sandboxInstanceId,
          },
        });
      }

      return ensuredSandbox;
    },
  );
}
