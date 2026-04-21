import type { ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import { systemSleeper } from "@mistle/time";

import type {
  EnsuredAutomationSandbox,
  PreparedAutomationRun,
} from "../shared/automation-run-types.js";
import {
  AutomationRunFailureCodes,
  createAutomationRunExecutionError,
} from "../shared/automation-run.js";
import {
  logAutomationConversationDeliveryEvent,
  withAutomationConversationDeliverySpan,
} from "./telemetry.js";
import type { AcquiredAutomationConnection } from "./types.js";

const SandboxStartTimeoutMs = 5 * 60 * 1000;
const SandboxStartPollIntervalMs = 1_000;

export async function acquireAutomationConnection(
  ctx: {
    controlPlaneInternalClient: ControlPlaneInternalClient;
  },
  input: {
    preparedAutomationRun: PreparedAutomationRun;
    ensuredAutomationSandbox: EnsuredAutomationSandbox;
    deliveryTaskId: string;
    workflowRunId: string;
  },
): Promise<AcquiredAutomationConnection> {
  if (input.preparedAutomationRun.renderedConversationKey.trim().length === 0) {
    throw createAutomationRunExecutionError({
      code: AutomationRunFailureCodes.TEMPLATE_RENDER_FAILED,
      message: "Rendered automation conversation key template must not be empty.",
    });
  }

  return await withAutomationConversationDeliverySpan(
    {
      name: "automation_conversation_delivery.sandbox.wait_running",
      telemetryContext: {
        automationRunId: input.preparedAutomationRun.automationRunId,
        conversationId: input.preparedAutomationRun.conversationId,
        deliveryTaskId: input.deliveryTaskId,
        sandboxInstanceId: input.ensuredAutomationSandbox.sandboxInstanceId,
        webhookEventId: input.preparedAutomationRun.webhookEventId,
        workflowRunId: input.workflowRunId,
      },
    },
    async (waitSpan) => {
      const waitStartedAt = Date.now();
      const deadline = waitStartedAt + SandboxStartTimeoutMs;
      let isSandboxRunning = false;
      let pollCount = 0;

      while (Date.now() < deadline) {
        const sandboxInstance = await ctx.controlPlaneInternalClient.getSandboxInstance({
          organizationId: input.preparedAutomationRun.organizationId,
          instanceId: input.ensuredAutomationSandbox.sandboxInstanceId,
        });
        pollCount += 1;

        waitSpan.setAttributes({
          "mistle.sandbox.poll_count": pollCount,
          "mistle.sandbox.status": sandboxInstance.status,
        });

        if (sandboxInstance.status === "running") {
          isSandboxRunning = true;
          waitSpan.setAttributes({
            "mistle.sandbox.wait_ms": Date.now() - waitStartedAt,
          });
          logAutomationConversationDeliveryEvent({
            eventName: "sandbox.running",
            message: "Automation conversation sandbox is running",
            telemetryContext: {
              automationRunId: input.preparedAutomationRun.automationRunId,
              conversationId: input.preparedAutomationRun.conversationId,
              deliveryTaskId: input.deliveryTaskId,
              sandboxInstanceId: sandboxInstance.id,
              webhookEventId: input.preparedAutomationRun.webhookEventId,
              workflowRunId: input.workflowRunId,
            },
            attributes: {
              "mistle.sandbox.poll_count": pollCount,
              "mistle.sandbox.wait_ms": Date.now() - waitStartedAt,
            },
          });
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

        if (sandboxInstance.status === "stopped") {
          logAutomationConversationDeliveryEvent({
            eventName: "connection_token.mint_started",
            message: "Minting sandbox connection token from stopped sandbox state",
            telemetryContext: {
              automationRunId: input.preparedAutomationRun.automationRunId,
              conversationId: input.preparedAutomationRun.conversationId,
              deliveryTaskId: input.deliveryTaskId,
              sandboxInstanceId: sandboxInstance.id,
              webhookEventId: input.preparedAutomationRun.webhookEventId,
              workflowRunId: input.workflowRunId,
            },
            attributes: {
              "mistle.sandbox.poll_count": pollCount,
              "mistle.sandbox.status": sandboxInstance.status,
            },
          });

          const connection = await ctx.controlPlaneInternalClient.mintSandboxConnectionToken({
            organizationId: input.preparedAutomationRun.organizationId,
            instanceId: sandboxInstance.id,
            ...(input.preparedAutomationRun.actingUserId === undefined
              ? {}
              : { actingUserId: input.preparedAutomationRun.actingUserId }),
          });

          logAutomationConversationDeliveryEvent({
            eventName: "connection_token.minted",
            message: "Minted sandbox connection token from stopped sandbox state",
            telemetryContext: {
              automationRunId: input.preparedAutomationRun.automationRunId,
              conversationId: input.preparedAutomationRun.conversationId,
              deliveryTaskId: input.deliveryTaskId,
              sandboxInstanceId: sandboxInstance.id,
              webhookEventId: input.preparedAutomationRun.webhookEventId,
              workflowRunId: input.workflowRunId,
            },
          });

          return {
            instanceId: connection.instanceId,
            url: connection.url,
            token: connection.token,
            expiresAt: connection.expiresAt,
          };
        }

        await systemSleeper.sleep(SandboxStartPollIntervalMs);
      }

      if (!isSandboxRunning) {
        throw createAutomationRunExecutionError({
          code: AutomationRunFailureCodes.AUTOMATION_RUN_EXECUTION_FAILED,
          message: `Sandbox instance '${input.ensuredAutomationSandbox.sandboxInstanceId}' did not become ready before the automation timeout elapsed.`,
        });
      }

      return await withAutomationConversationDeliverySpan(
        {
          name: "automation_conversation_delivery.connection.mint",
          telemetryContext: {
            automationRunId: input.preparedAutomationRun.automationRunId,
            conversationId: input.preparedAutomationRun.conversationId,
            deliveryTaskId: input.deliveryTaskId,
            sandboxInstanceId: input.ensuredAutomationSandbox.sandboxInstanceId,
            webhookEventId: input.preparedAutomationRun.webhookEventId,
            workflowRunId: input.workflowRunId,
          },
        },
        async (mintSpan) => {
          const mintStartedAt = Date.now();
          logAutomationConversationDeliveryEvent({
            eventName: "connection_token.mint_started",
            message: "Minting sandbox connection token",
            telemetryContext: {
              automationRunId: input.preparedAutomationRun.automationRunId,
              conversationId: input.preparedAutomationRun.conversationId,
              deliveryTaskId: input.deliveryTaskId,
              sandboxInstanceId: input.ensuredAutomationSandbox.sandboxInstanceId,
              webhookEventId: input.preparedAutomationRun.webhookEventId,
              workflowRunId: input.workflowRunId,
            },
          });

          try {
            const connection = await ctx.controlPlaneInternalClient.mintSandboxConnectionToken({
              organizationId: input.preparedAutomationRun.organizationId,
              instanceId: input.ensuredAutomationSandbox.sandboxInstanceId,
              ...(input.preparedAutomationRun.actingUserId === undefined
                ? {}
                : { actingUserId: input.preparedAutomationRun.actingUserId }),
              webhookEventId: input.preparedAutomationRun.webhookEventId,
              deliveryTaskId: input.deliveryTaskId,
              automationRunId: input.preparedAutomationRun.automationRunId,
              conversationId: input.preparedAutomationRun.conversationId,
              ...(input.preparedAutomationRun.webhookExternalDeliveryId === null
                ? {}
                : {
                    externalDeliveryId: input.preparedAutomationRun.webhookExternalDeliveryId,
                  }),
            });
            const mintDurationMs = Date.now() - mintStartedAt;

            mintSpan.setAttributes({
              "mistle.connection.mint_ms": mintDurationMs,
              "mistle.connection.token_jti": connection.tokenJti,
            });
            logAutomationConversationDeliveryEvent({
              eventName: "connection_token.minted",
              message: "Minted sandbox connection token",
              telemetryContext: {
                automationRunId: input.preparedAutomationRun.automationRunId,
                conversationId: input.preparedAutomationRun.conversationId,
                deliveryTaskId: input.deliveryTaskId,
                sandboxInstanceId: input.ensuredAutomationSandbox.sandboxInstanceId,
                webhookEventId: input.preparedAutomationRun.webhookEventId,
                workflowRunId: input.workflowRunId,
              },
              attributes: {
                "mistle.connection.mint_ms": mintDurationMs,
                "mistle.connection.token_jti": connection.tokenJti,
              },
            });

            return {
              instanceId: connection.instanceId,
              url: connection.url,
              token: connection.token,
              expiresAt: connection.expiresAt,
            };
          } catch (error) {
            logAutomationConversationDeliveryEvent({
              eventName: "connection_token.failed",
              message: "Failed to mint sandbox connection token",
              telemetryContext: {
                automationRunId: input.preparedAutomationRun.automationRunId,
                conversationId: input.preparedAutomationRun.conversationId,
                deliveryTaskId: input.deliveryTaskId,
                sandboxInstanceId: input.ensuredAutomationSandbox.sandboxInstanceId,
                webhookEventId: input.preparedAutomationRun.webhookEventId,
                workflowRunId: input.workflowRunId,
              },
              err: error,
              level: "error",
            });
            throw error;
          }
        },
      );
    },
  );
}
