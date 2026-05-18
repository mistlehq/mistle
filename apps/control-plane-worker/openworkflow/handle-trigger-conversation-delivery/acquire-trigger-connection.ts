import type { ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import { systemSleeper } from "@mistle/time";

import type { EnsuredTriggerSandbox, PreparedTriggerRun } from "../shared/trigger-run-types.js";
import { TriggerRunFailureCodes, createTriggerRunExecutionError } from "../shared/trigger-run.js";
import {
  logTriggerConversationDeliveryEvent,
  withTriggerConversationDeliverySpan,
} from "./telemetry.js";
import type { AcquiredTriggerConnection } from "./types.js";

const SandboxStartTimeoutMs = 5 * 60 * 1000;
const SandboxStartPollIntervalMs = 1_000;

export async function acquireTriggerConnection(
  ctx: {
    controlPlaneInternalClient: ControlPlaneInternalClient;
  },
  input: {
    preparedTriggerRun: PreparedTriggerRun;
    ensuredTriggerSandbox: EnsuredTriggerSandbox;
    deliveryTaskId: string;
    workflowRunId: string;
  },
): Promise<AcquiredTriggerConnection> {
  if (input.preparedTriggerRun.renderedConversationKey.trim().length === 0) {
    throw createTriggerRunExecutionError({
      code: TriggerRunFailureCodes.TEMPLATE_RENDER_FAILED,
      message: "Rendered trigger conversation key template must not be empty.",
    });
  }

  return await withTriggerConversationDeliverySpan(
    {
      name: "trigger_conversation_delivery.sandbox.wait_running",
      telemetryContext: {
        triggerRunId: input.preparedTriggerRun.triggerRunId,
        conversationId: input.preparedTriggerRun.conversationId,
        deliveryTaskId: input.deliveryTaskId,
        sandboxInstanceId: input.ensuredTriggerSandbox.sandboxInstanceId,
        webhookEventId: input.preparedTriggerRun.webhookEventId,
        workflowRunId: input.workflowRunId,
      },
    },
    async (waitSpan) => {
      const waitStartedAt = Date.now();
      const deadline = waitStartedAt + SandboxStartTimeoutMs;
      let isSandboxRunning = false;
      let didRequestResume = false;
      let pollCount = 0;

      while (Date.now() < deadline) {
        const sandboxInstance = await ctx.controlPlaneInternalClient.getSandboxInstance({
          organizationId: input.preparedTriggerRun.organizationId,
          instanceId: input.ensuredTriggerSandbox.sandboxInstanceId,
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
          logTriggerConversationDeliveryEvent({
            eventName: "sandbox.running",
            message: "Trigger conversation sandbox is running",
            telemetryContext: {
              triggerRunId: input.preparedTriggerRun.triggerRunId,
              conversationId: input.preparedTriggerRun.conversationId,
              deliveryTaskId: input.deliveryTaskId,
              sandboxInstanceId: sandboxInstance.id,
              webhookEventId: input.preparedTriggerRun.webhookEventId,
              workflowRunId: input.workflowRunId,
            },
            attributes: {
              "mistle.sandbox.poll_count": pollCount,
              "mistle.sandbox.wait_phase": didRequestResume ? "resume" : "startup",
              "mistle.sandbox.wait_ms": Date.now() - waitStartedAt,
            },
          });
          if (didRequestResume) {
            logTriggerConversationDeliveryEvent({
              eventName: "sandbox.resume_running",
              message: "Trigger conversation sandbox resumed and became running",
              telemetryContext: {
                triggerRunId: input.preparedTriggerRun.triggerRunId,
                conversationId: input.preparedTriggerRun.conversationId,
                deliveryTaskId: input.deliveryTaskId,
                sandboxInstanceId: sandboxInstance.id,
                webhookEventId: input.preparedTriggerRun.webhookEventId,
                workflowRunId: input.workflowRunId,
              },
              attributes: {
                "mistle.sandbox.poll_count": pollCount,
                "mistle.sandbox.wait_ms": Date.now() - waitStartedAt,
              },
            });
          }
          break;
        }

        if (sandboxInstance.status === "failed") {
          throw createTriggerRunExecutionError({
            code: TriggerRunFailureCodes.TRIGGER_RUN_EXECUTION_FAILED,
            message:
              sandboxInstance.failureMessage ??
              `Sandbox instance '${sandboxInstance.id}' entered terminal status '${sandboxInstance.status}' before it became ready.`,
          });
        }

        if (sandboxInstance.status === "stopped" && !didRequestResume) {
          didRequestResume = true;
          logTriggerConversationDeliveryEvent({
            eventName: "sandbox.resume_requested",
            message: "Requesting sandbox resume before trigger connection token mint",
            telemetryContext: {
              triggerRunId: input.preparedTriggerRun.triggerRunId,
              conversationId: input.preparedTriggerRun.conversationId,
              deliveryTaskId: input.deliveryTaskId,
              sandboxInstanceId: sandboxInstance.id,
              webhookEventId: input.preparedTriggerRun.webhookEventId,
              workflowRunId: input.workflowRunId,
            },
            attributes: {
              "mistle.sandbox.poll_count": pollCount,
              "mistle.sandbox.status": sandboxInstance.status,
              "mistle.sandbox.wait_phase": "resume",
              "mistle.sandbox.wait_timeout_ms": SandboxStartTimeoutMs,
              "mistle.sandbox.poll_interval_ms": SandboxStartPollIntervalMs,
            },
          });

          const resumeResult =
            await ctx.controlPlaneInternalClient.resumeSandboxInstanceForConnection({
              organizationId: input.preparedTriggerRun.organizationId,
              instanceId: sandboxInstance.id,
              ...(input.preparedTriggerRun.actingUserId === undefined
                ? {}
                : { actingUserId: input.preparedTriggerRun.actingUserId }),
              idempotencyKey: `automation-delivery-resume:${input.deliveryTaskId}:${sandboxInstance.id}`,
            });

          waitSpan.setAttributes({
            "mistle.sandbox.resume_requested": true,
            "mistle.sandbox.resume_workflow_run_id": resumeResult.workflowRunId,
            "mistle.sandbox.wait_phase": "resume",
            "mistle.sandbox.wait_timeout_ms": SandboxStartTimeoutMs,
            "mistle.sandbox.poll_interval_ms": SandboxStartPollIntervalMs,
          });

          logTriggerConversationDeliveryEvent({
            eventName: "sandbox.resume_wait_started",
            message: "Waiting for resumed trigger conversation sandbox to become running",
            telemetryContext: {
              triggerRunId: input.preparedTriggerRun.triggerRunId,
              conversationId: input.preparedTriggerRun.conversationId,
              deliveryTaskId: input.deliveryTaskId,
              sandboxInstanceId: sandboxInstance.id,
              webhookEventId: input.preparedTriggerRun.webhookEventId,
              workflowRunId: input.workflowRunId,
            },
            attributes: {
              "mistle.sandbox.poll_count": pollCount,
              "mistle.sandbox.resume_workflow_run_id": resumeResult.workflowRunId,
              "mistle.sandbox.status": sandboxInstance.status,
              "mistle.sandbox.wait_timeout_ms": SandboxStartTimeoutMs,
              "mistle.sandbox.poll_interval_ms": SandboxStartPollIntervalMs,
            },
          });
        }

        await systemSleeper.sleep(SandboxStartPollIntervalMs);
      }

      if (!isSandboxRunning) {
        logTriggerConversationDeliveryEvent({
          eventName: didRequestResume ? "sandbox.resume_wait_timed_out" : "sandbox.wait_timed_out",
          message: "Trigger conversation sandbox did not become running before timeout",
          telemetryContext: {
            triggerRunId: input.preparedTriggerRun.triggerRunId,
            conversationId: input.preparedTriggerRun.conversationId,
            deliveryTaskId: input.deliveryTaskId,
            sandboxInstanceId: input.ensuredTriggerSandbox.sandboxInstanceId,
            webhookEventId: input.preparedTriggerRun.webhookEventId,
            workflowRunId: input.workflowRunId,
          },
          attributes: {
            "mistle.sandbox.poll_count": pollCount,
            "mistle.sandbox.wait_phase": didRequestResume ? "resume" : "startup",
            "mistle.sandbox.wait_ms": Date.now() - waitStartedAt,
            "mistle.sandbox.wait_timeout_ms": SandboxStartTimeoutMs,
          },
          level: "warn",
        });
        throw createTriggerRunExecutionError({
          code: TriggerRunFailureCodes.TRIGGER_RUN_EXECUTION_FAILED,
          message: `Sandbox instance '${input.ensuredTriggerSandbox.sandboxInstanceId}' did not become ready before the trigger timeout elapsed.`,
        });
      }

      return await withTriggerConversationDeliverySpan(
        {
          name: "trigger_conversation_delivery.connection.mint",
          telemetryContext: {
            triggerRunId: input.preparedTriggerRun.triggerRunId,
            conversationId: input.preparedTriggerRun.conversationId,
            deliveryTaskId: input.deliveryTaskId,
            sandboxInstanceId: input.ensuredTriggerSandbox.sandboxInstanceId,
            webhookEventId: input.preparedTriggerRun.webhookEventId,
            workflowRunId: input.workflowRunId,
          },
        },
        async (mintSpan) => {
          const mintStartedAt = Date.now();
          logTriggerConversationDeliveryEvent({
            eventName: "connection_token.mint_started",
            message: "Minting sandbox connection token",
            telemetryContext: {
              triggerRunId: input.preparedTriggerRun.triggerRunId,
              conversationId: input.preparedTriggerRun.conversationId,
              deliveryTaskId: input.deliveryTaskId,
              sandboxInstanceId: input.ensuredTriggerSandbox.sandboxInstanceId,
              webhookEventId: input.preparedTriggerRun.webhookEventId,
              workflowRunId: input.workflowRunId,
            },
          });

          try {
            const connection = await ctx.controlPlaneInternalClient.mintSandboxConnectionToken({
              organizationId: input.preparedTriggerRun.organizationId,
              instanceId: input.ensuredTriggerSandbox.sandboxInstanceId,
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

            mintSpan.setAttributes({
              "mistle.connection.mint_ms": mintDurationMs,
              "mistle.connection.token_jti": connection.tokenJti,
            });
            logTriggerConversationDeliveryEvent({
              eventName: "connection_token.minted",
              message: "Minted sandbox connection token",
              telemetryContext: {
                triggerRunId: input.preparedTriggerRun.triggerRunId,
                conversationId: input.preparedTriggerRun.conversationId,
                deliveryTaskId: input.deliveryTaskId,
                sandboxInstanceId: input.ensuredTriggerSandbox.sandboxInstanceId,
                webhookEventId: input.preparedTriggerRun.webhookEventId,
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
            logTriggerConversationDeliveryEvent({
              eventName: "connection_token.failed",
              message: "Failed to mint sandbox connection token",
              telemetryContext: {
                triggerRunId: input.preparedTriggerRun.triggerRunId,
                conversationId: input.preparedTriggerRun.conversationId,
                deliveryTaskId: input.deliveryTaskId,
                sandboxInstanceId: input.ensuredTriggerSandbox.sandboxInstanceId,
                webhookEventId: input.preparedTriggerRun.webhookEventId,
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
