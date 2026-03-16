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
import type { ResolvedAutomationConversationDeliveryRoute } from "./types.js";

export async function ensureConversationDeliverySandbox(
  ctx: {
    db: ControlPlaneDatabase;
    controlPlaneInternalClient: ControlPlaneInternalClient;
  },
  input: {
    preparedAutomationRun: PreparedAutomationRun;
    resolvedAutomationConversationRoute: ResolvedAutomationConversationDeliveryRoute;
  },
): Promise<EnsuredAutomationSandbox> {
  if (input.resolvedAutomationConversationRoute.sandboxInstanceId !== null) {
    const existingSandbox = await ctx.controlPlaneInternalClient.getSandboxInstance({
      organizationId: input.preparedAutomationRun.organizationId,
      instanceId: input.resolvedAutomationConversationRoute.sandboxInstanceId,
    });

    const sandboxAction = resolveAutomationConversationDeliverySandboxAction({
      sandboxInstanceId: input.resolvedAutomationConversationRoute.sandboxInstanceId,
      sandboxStatus: existingSandbox.status,
    });

    if (sandboxAction === AutomationConversationDeliverySandboxActions.REUSE_EXISTING) {
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

  return ensureAutomationSandbox(
    {
      db: ctx.db,
      controlPlaneInternalClient: ctx.controlPlaneInternalClient,
    },
    {
      preparedAutomationRun: input.preparedAutomationRun,
    },
  );
}
