import type { ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import type { ControlPlaneDatabase } from "@mistle/db/control-plane";

import type {
  EnsuredAutomationSandbox,
  PreparedAutomationRun,
} from "../shared/automation-run-types.js";
import { ensureAutomationSandbox } from "../shared/automation-run.js";
import {
  AutomationConversationDeliverySandboxActions,
  resolveAutomationConversationDeliverySandboxAction,
} from "./conversation-delivery-planning.js";
import {
  logAutomationConversationDeliveryEvent,
  withAutomationConversationDeliverySpan,
} from "./telemetry.js";
import type { ResolvedAutomationConversationDeliveryRoute } from "./types.js";

export async function ensureConversationDeliverySandbox(
  ctx: {
    db: ControlPlaneDatabase;
    controlPlaneInternalClient: ControlPlaneInternalClient;
  },
  input: {
    deliveryTaskId: string;
    preparedAutomationRun: PreparedAutomationRun;
    resolvedAutomationConversationRoute: ResolvedAutomationConversationDeliveryRoute;
    workflowRunId: string;
  },
): Promise<EnsuredAutomationSandbox> {
  return await withAutomationConversationDeliverySpan(
    {
      name: "automation_conversation_delivery.sandbox.ensure",
      telemetryContext: {
        automationRunId: input.preparedAutomationRun.automationRunId,
        conversationId: input.preparedAutomationRun.conversationId,
        deliveryTaskId: input.deliveryTaskId,
        routeId: input.resolvedAutomationConversationRoute.routeId ?? undefined,
        sandboxInstanceId: input.resolvedAutomationConversationRoute.sandboxInstanceId ?? undefined,
        webhookEventId: input.preparedAutomationRun.webhookEventId,
        workflowRunId: input.workflowRunId,
      },
    },
    async (span) => {
      if (input.resolvedAutomationConversationRoute.sandboxInstanceId !== null) {
        const existingSandbox = await ctx.controlPlaneInternalClient.getSandboxInstance({
          organizationId: input.preparedAutomationRun.organizationId,
          instanceId: input.resolvedAutomationConversationRoute.sandboxInstanceId,
        });

        const sandboxAction = resolveAutomationConversationDeliverySandboxAction({
          sandboxInstanceId: input.resolvedAutomationConversationRoute.sandboxInstanceId,
          sandboxStatus: existingSandbox.status,
        });

        span.setAttributes({
          "mistle.sandbox.decision": sandboxAction,
          "mistle.sandbox.status": existingSandbox.status,
        });

        if (sandboxAction === AutomationConversationDeliverySandboxActions.REUSE_EXISTING) {
          logAutomationConversationDeliveryEvent({
            eventName: "sandbox.reused",
            message: "Reusing automation conversation sandbox",
            telemetryContext: {
              automationRunId: input.preparedAutomationRun.automationRunId,
              conversationId: input.preparedAutomationRun.conversationId,
              deliveryTaskId: input.deliveryTaskId,
              routeId: input.resolvedAutomationConversationRoute.routeId ?? undefined,
              sandboxInstanceId: existingSandbox.id,
              webhookEventId: input.preparedAutomationRun.webhookEventId,
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

        if (sandboxAction === AutomationConversationDeliverySandboxActions.FAIL) {
          throw new Error(
            `AutomationConversation '${input.preparedAutomationRun.conversationId}' is bound to sandbox '${input.resolvedAutomationConversationRoute.sandboxInstanceId}', but that sandbox is '${existingSandbox.status}'.`,
          );
        }
      }

      span.setAttribute(
        "mistle.sandbox.decision",
        AutomationConversationDeliverySandboxActions.START_NEW,
      );

      const ensuredSandbox = await ensureAutomationSandbox(
        {
          db: ctx.db,
          controlPlaneInternalClient: ctx.controlPlaneInternalClient,
        },
        {
          preparedAutomationRun: input.preparedAutomationRun,
        },
      );
      span.setAttribute("mistle.sandbox.instance_id", ensuredSandbox.sandboxInstanceId);

      return ensuredSandbox;
    },
  );
}
