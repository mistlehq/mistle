import type { ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import {
  getSandboxDeliveryDisposition,
  SandboxDeliveryDispositions,
  SandboxInstanceStatuses,
  type SandboxInstanceStatus,
} from "@mistle/sandbox-lifecycle";
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
type SandboxWaitPhase = "startup" | "resume" | "reconnect";
export type TriggerConnectionAcquisitionPollAction =
  | {
      action: "mint_connection";
      waitPhase: SandboxWaitPhase;
    }
  | {
      action: "fail_terminal";
      waitPhase: SandboxWaitPhase;
    }
  | {
      action: "request_resume";
      waitPhase: SandboxWaitPhase;
    }
  | {
      action: "wait";
      waitPhase: SandboxWaitPhase;
    };

function resolveSandboxWaitPhase(input: {
  status: SandboxInstanceStatus;
  didRequestResume: boolean;
}): SandboxWaitPhase {
  if (input.didRequestResume) {
    return "resume";
  }

  if (
    input.status === SandboxInstanceStatuses.DEGRADED ||
    input.status === SandboxInstanceStatuses.RECONNECTING
  ) {
    return "reconnect";
  }

  if (input.status === SandboxInstanceStatuses.STOPPED) {
    return "resume";
  }

  return "startup";
}

export function resolveTriggerConnectionAcquisitionPollAction(input: {
  status: SandboxInstanceStatus;
  didRequestResume: boolean;
}): TriggerConnectionAcquisitionPollAction {
  const waitPhase = resolveSandboxWaitPhase(input);
  const deliveryDisposition = getSandboxDeliveryDisposition(input.status);

  if (deliveryDisposition === SandboxDeliveryDispositions.DELIVER) {
    return {
      action: "mint_connection",
      waitPhase,
    };
  }

  if (deliveryDisposition === SandboxDeliveryDispositions.RECOVER) {
    return {
      action: "fail_terminal",
      waitPhase,
    };
  }

  if (
    deliveryDisposition === SandboxDeliveryDispositions.RESUME &&
    input.status === SandboxInstanceStatuses.STOPPED &&
    !input.didRequestResume
  ) {
    return {
      action: "request_resume",
      waitPhase,
    };
  }

  return {
    action: "wait",
    waitPhase,
  };
}

export async function acquireTriggerConnection(
  ctx: {
    controlPlaneInternalClient: ControlPlaneInternalClient;
  },
  input: {
    preparedTriggerRun: PreparedTriggerRun;
    ensuredTriggerSandbox: EnsuredTriggerSandbox;
    deliveryTaskId: string;
    workflowRunId: string;
    timing?: {
      timeoutMs: number;
      pollIntervalMs: number;
    };
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
      const timeoutMs = input.timing?.timeoutMs ?? SandboxStartTimeoutMs;
      const pollIntervalMs = input.timing?.pollIntervalMs ?? SandboxStartPollIntervalMs;
      const waitStartedAt = Date.now();
      const deadline = waitStartedAt + timeoutMs;
      let isSandboxRunning = false;
      let didRequestResume = false;
      let lastObservedSandboxStatus: SandboxInstanceStatus | null = null;
      let pollCount = 0;

      while (Date.now() < deadline) {
        const sandboxInstance = await ctx.controlPlaneInternalClient.getSandboxInstance({
          organizationId: input.preparedTriggerRun.organizationId,
          instanceId: input.ensuredTriggerSandbox.sandboxInstanceId,
        });
        pollCount += 1;
        lastObservedSandboxStatus = sandboxInstance.status;
        const pollAction = resolveTriggerConnectionAcquisitionPollAction({
          status: sandboxInstance.status,
          didRequestResume,
        });

        waitSpan.setAttributes({
          "mistle.sandbox.poll_count": pollCount,
          "mistle.sandbox.status": sandboxInstance.status,
          "mistle.sandbox.wait_phase": pollAction.waitPhase,
        });

        if (pollAction.action === "mint_connection") {
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
              "mistle.sandbox.wait_phase": pollAction.waitPhase,
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

        if (pollAction.action === "fail_terminal") {
          throw createTriggerRunExecutionError({
            code: TriggerRunFailureCodes.TRIGGER_RUN_EXECUTION_FAILED,
            message:
              sandboxInstance.failureMessage ??
              `Sandbox instance '${sandboxInstance.id}' entered terminal status '${sandboxInstance.status}' before it became ready.`,
            metadata: {
              "mistle.sandbox.instance_id": sandboxInstance.id,
              "mistle.sandbox.status": sandboxInstance.status,
              "mistle.sandbox.failure_code": sandboxInstance.failureCode,
              "mistle.sandbox.failure_message": sandboxInstance.failureMessage,
              "mistle.sandbox.poll_count": pollCount,
              "mistle.sandbox.wait_phase": pollAction.waitPhase,
              "mistle.sandbox.wait_ms": Date.now() - waitStartedAt,
            },
          });
        }

        if (pollAction.action === "request_resume") {
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
              "mistle.sandbox.wait_phase": pollAction.waitPhase,
              "mistle.sandbox.wait_timeout_ms": timeoutMs,
              "mistle.sandbox.poll_interval_ms": pollIntervalMs,
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
            "mistle.sandbox.wait_phase": pollAction.waitPhase,
            "mistle.sandbox.wait_timeout_ms": timeoutMs,
            "mistle.sandbox.poll_interval_ms": pollIntervalMs,
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
              "mistle.sandbox.wait_timeout_ms": timeoutMs,
              "mistle.sandbox.poll_interval_ms": pollIntervalMs,
            },
          });
        }

        await systemSleeper.sleep(pollIntervalMs);
      }

      if (!isSandboxRunning) {
        const waitPhase =
          lastObservedSandboxStatus === null
            ? "startup"
            : resolveSandboxWaitPhase({
                status: lastObservedSandboxStatus,
                didRequestResume,
              });
        const wasNonDeliverable =
          lastObservedSandboxStatus !== null &&
          getSandboxDeliveryDisposition(lastObservedSandboxStatus) ===
            SandboxDeliveryDispositions.NON_DELIVERABLE;
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
            ...(lastObservedSandboxStatus === null
              ? {}
              : { "mistle.sandbox.status": lastObservedSandboxStatus }),
            "mistle.sandbox.wait_phase": waitPhase,
            "mistle.sandbox.wait_ms": Date.now() - waitStartedAt,
            "mistle.sandbox.wait_timeout_ms": timeoutMs,
          },
          level: "warn",
        });
        throw createTriggerRunExecutionError({
          code: TriggerRunFailureCodes.TRIGGER_RUN_EXECUTION_FAILED,
          message: wasNonDeliverable
            ? `Sandbox instance '${input.ensuredTriggerSandbox.sandboxInstanceId}' remained in non-deliverable status '${lastObservedSandboxStatus}' before the trigger timeout elapsed.`
            : `Sandbox instance '${input.ensuredTriggerSandbox.sandboxInstanceId}' did not become ready before the trigger timeout elapsed.`,
          metadata: {
            "mistle.sandbox.instance_id": input.ensuredTriggerSandbox.sandboxInstanceId,
            "mistle.sandbox.poll_count": pollCount,
            ...(lastObservedSandboxStatus === null
              ? {}
              : { "mistle.sandbox.status": lastObservedSandboxStatus }),
            "mistle.sandbox.wait_phase": waitPhase,
            "mistle.sandbox.wait_ms": Date.now() - waitStartedAt,
            "mistle.sandbox.wait_timeout_ms": timeoutMs,
          },
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
