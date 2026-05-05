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
    dataPlaneClient: Pick<DataPlaneSandboxInstancesClient, "refreshSandboxEgressGrants">;
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
      let didRequestResume = false;
      let didRefreshRunningSandboxEgressGrants = false;
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
          if (
            input.ensuredAutomationSandbox.startupWorkflowRunId === null &&
            !didRefreshRunningSandboxEgressGrants
          ) {
            didRefreshRunningSandboxEgressGrants = true;
            logAutomationConversationDeliveryEvent({
              eventName: "sandbox.egress_grants_refresh_requested",
              message:
                "Refreshing running sandbox egress grants before automation connection token mint",
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
                "mistle.sandbox.wait_phase": "egress_grants_refresh",
              },
            });

            await ctx.dataPlaneClient.refreshSandboxEgressGrants({
              organizationId: input.preparedAutomationRun.organizationId,
              instanceId: sandboxInstance.id,
              ...(input.preparedAutomationRun.actingUserId === undefined
                ? {}
                : { actingUserId: input.preparedAutomationRun.actingUserId }),
            });

            waitSpan.setAttributes({
              "mistle.sandbox.egress_grants_refreshed": true,
            });
          }

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
              "mistle.sandbox.wait_phase": didRequestResume ? "resume" : "startup",
              "mistle.sandbox.wait_ms": Date.now() - waitStartedAt,
            },
          });
          if (didRequestResume) {
            logAutomationConversationDeliveryEvent({
              eventName: "sandbox.resume_running",
              message: "Automation conversation sandbox resumed and became running",
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
          }
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

        if (sandboxInstance.status === "stopped" && !didRequestResume) {
          didRequestResume = true;
          logAutomationConversationDeliveryEvent({
            eventName: "sandbox.resume_requested",
            message: "Requesting sandbox resume before automation connection token mint",
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
              "mistle.sandbox.wait_phase": "resume",
              "mistle.sandbox.wait_timeout_ms": SandboxStartTimeoutMs,
              "mistle.sandbox.poll_interval_ms": SandboxStartPollIntervalMs,
            },
          });

          const resumeResult =
            await ctx.controlPlaneInternalClient.resumeSandboxInstanceForConnection({
              organizationId: input.preparedAutomationRun.organizationId,
              instanceId: sandboxInstance.id,
              ...(input.preparedAutomationRun.actingUserId === undefined
                ? {}
                : { actingUserId: input.preparedAutomationRun.actingUserId }),
              idempotencyKey: `automation-delivery-resume:${input.deliveryTaskId}:${sandboxInstance.id}`,
            });

          waitSpan.setAttributes({
            "mistle.sandbox.resume_requested": true,
            "mistle.sandbox.resume_workflow_run_id": resumeResult.workflowRunId,
            "mistle.sandbox.wait_phase": "resume",
            "mistle.sandbox.wait_timeout_ms": SandboxStartTimeoutMs,
            "mistle.sandbox.poll_interval_ms": SandboxStartPollIntervalMs,
          });

          logAutomationConversationDeliveryEvent({
            eventName: "sandbox.resume_wait_started",
            message: "Waiting for resumed automation conversation sandbox to become running",
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
        logAutomationConversationDeliveryEvent({
          eventName: didRequestResume ? "sandbox.resume_wait_timed_out" : "sandbox.wait_timed_out",
          message: "Automation conversation sandbox did not become running before timeout",
          telemetryContext: {
            automationRunId: input.preparedAutomationRun.automationRunId,
            conversationId: input.preparedAutomationRun.conversationId,
            deliveryTaskId: input.deliveryTaskId,
            sandboxInstanceId: input.ensuredAutomationSandbox.sandboxInstanceId,
            webhookEventId: input.preparedAutomationRun.webhookEventId,
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
