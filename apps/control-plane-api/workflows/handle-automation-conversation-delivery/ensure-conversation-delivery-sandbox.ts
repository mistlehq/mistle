import {
  ensureAutomationSandbox,
  type EnsuredAutomationSandbox,
  type PreparedAutomationRun,
} from "../shared/automation/index.js";
import { AutomationConversationDeliverySandboxActions } from "./types.js";
import type {
  ConversationDeliverySandboxAction,
  HandleAutomationConversationDeliveryDependencies,
  ResolvedAutomationConversationDeliveryRoute,
} from "./types.js";

function resolveAutomationConversationDeliverySandboxAction(input: {
  sandboxInstanceId: string | null;
  sandboxStatus: "starting" | "running" | "stopped" | "failed" | null;
}): ConversationDeliverySandboxAction {
  if (input.sandboxInstanceId === null) {
    return AutomationConversationDeliverySandboxActions.START_NEW;
  }
  if (input.sandboxStatus === "running") {
    return AutomationConversationDeliverySandboxActions.REUSE_EXISTING;
  }

  return AutomationConversationDeliverySandboxActions.FAIL;
}

export async function ensureConversationDeliverySandbox(
  ctx: Pick<
    HandleAutomationConversationDeliveryDependencies,
    "db" | "getSandboxInstance" | "startSandboxProfileInstance"
  >,
  input: {
    preparedAutomationRun: PreparedAutomationRun;
    resolvedAutomationConversationRoute: ResolvedAutomationConversationDeliveryRoute;
  },
): Promise<EnsuredAutomationSandbox> {
  if (input.resolvedAutomationConversationRoute.sandboxInstanceId !== null) {
    const existingSandbox = await ctx.getSandboxInstance({
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
      startSandboxProfileInstance: ctx.startSandboxProfileInstance,
    },
    {
      preparedAutomationRun: input.preparedAutomationRun,
    },
  );
}
