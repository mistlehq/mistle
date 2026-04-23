import type { ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import type { DataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import { systemSleeper } from "@mistle/time";

import type {
  EnsuredAutomationSandbox,
  PreparedAutomationRun,
} from "../shared/automation-run-types.js";
import {
  AutomationRunFailureCodes,
  createAutomationRunExecutionError,
} from "../shared/automation-run.js";
import type { AcquiredAutomationConnection } from "./types.js";

const SandboxStartTimeoutMs = 5 * 60 * 1000;
const SandboxStartPollIntervalMs = 1_000;

export function createAutomationSandboxResumeIdempotencyKey(input: {
  automationRunId: string;
  sandboxInstanceId: string;
}): string {
  return `automation-run-resume:${input.automationRunId}:${input.sandboxInstanceId}`;
}

export async function acquireAutomationConnection(
  ctx: {
    controlPlaneInternalClient: ControlPlaneInternalClient;
    dataPlaneClient: Pick<DataPlaneSandboxInstancesClient, "resumeSandboxInstance">;
  },
  input: {
    preparedAutomationRun: PreparedAutomationRun;
    ensuredAutomationSandbox: EnsuredAutomationSandbox;
  },
): Promise<AcquiredAutomationConnection> {
  if (input.preparedAutomationRun.renderedConversationKey.trim().length === 0) {
    throw createAutomationRunExecutionError({
      code: AutomationRunFailureCodes.TEMPLATE_RENDER_FAILED,
      message: "Rendered automation conversation key template must not be empty.",
    });
  }

  const deadline = Date.now() + SandboxStartTimeoutMs;
  let isSandboxRunning = false;
  let hasRequestedResume = false;
  while (Date.now() < deadline) {
    const sandboxInstance = await ctx.controlPlaneInternalClient.getSandboxInstance({
      organizationId: input.preparedAutomationRun.organizationId,
      instanceId: input.ensuredAutomationSandbox.sandboxInstanceId,
    });

    if (sandboxInstance.status === "running") {
      isSandboxRunning = true;
      break;
    }

    if (sandboxInstance.status === "failed") {
      throw createAutomationRunExecutionError({
        code: AutomationRunFailureCodes.AUTOMATION_RUN_EXECUTION_FAILED,
        message:
          sandboxInstance.failureMessage ??
          `Sandbox instance '${sandboxInstance.id}' entered terminal status '${sandboxInstance.status}' before it became ready.`,
      });
    }

    if (sandboxInstance.status === "stopped" && !hasRequestedResume) {
      await ctx.dataPlaneClient.resumeSandboxInstance({
        organizationId: input.preparedAutomationRun.organizationId,
        instanceId: sandboxInstance.id,
        idempotencyKey: createAutomationSandboxResumeIdempotencyKey({
          automationRunId: input.preparedAutomationRun.automationRunId,
          sandboxInstanceId: sandboxInstance.id,
        }),
      });
      hasRequestedResume = true;
    }

    await systemSleeper.sleep(SandboxStartPollIntervalMs);
  }

  if (!isSandboxRunning) {
    throw createAutomationRunExecutionError({
      code: AutomationRunFailureCodes.AUTOMATION_RUN_EXECUTION_FAILED,
      message: `Sandbox instance '${input.ensuredAutomationSandbox.sandboxInstanceId}' did not become ready before the automation timeout elapsed.`,
    });
  }

  const connection = await ctx.controlPlaneInternalClient.mintSandboxConnectionToken({
    organizationId: input.preparedAutomationRun.organizationId,
    instanceId: input.ensuredAutomationSandbox.sandboxInstanceId,
    ...(input.preparedAutomationRun.actingUserId === undefined
      ? {}
      : { actingUserId: input.preparedAutomationRun.actingUserId }),
  });

  return {
    instanceId: connection.instanceId,
    url: connection.url,
    token: connection.token,
    expiresAt: connection.expiresAt,
  };
}
