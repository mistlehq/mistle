import type { SandboxProvider } from "@mistle/sandbox";
import { defineWorkflow, type Workflow } from "openworkflow";

import {
  StartSandboxInstanceWorkflowSpec,
  type StartSandboxInstanceWorkflowInput,
  type StartSandboxInstanceWorkflowOutput,
} from "./spec.js";

const StartSandboxFailureCodes = {
  TUNNEL_CONNECT_ACK_TIMEOUT: "tunnel_connect_ack_timeout",
  TUNNEL_CONNECT_ACK_WAIT_FAILED: "tunnel_connect_ack_wait_failed",
  STATUS_TRANSITION_TO_RUNNING_FAILED: "status_transition_to_running_failed",
} as const;

type UpdateSandboxInstanceStatusInput =
  | {
      sandboxInstanceId: string;
      status: "running";
    }
  | {
      sandboxInstanceId: string;
      status: "failed";
      failureCode: string;
      failureMessage: string;
    };

export type CreateStartSandboxInstanceWorkflowInput = {
  startSandbox: (input: { image: StartSandboxInstanceWorkflowInput["image"] }) => Promise<{
    provider: SandboxProvider;
    providerSandboxId: string;
    bootstrapTokenJti: string;
  }>;
  stopSandbox: (input: { provider: SandboxProvider; providerSandboxId: string }) => Promise<void>;
  insertSandboxInstance: (input: {
    organizationId: string;
    sandboxProfileId: string;
    sandboxProfileVersion: number;
    provider: SandboxProvider;
    providerSandboxId: string;
    startedBy: StartSandboxInstanceWorkflowInput["startedBy"];
    source: StartSandboxInstanceWorkflowInput["source"];
  }) => Promise<{
    sandboxInstanceId: string;
  }>;
  waitForSandboxTunnelConnectAck: (input: { bootstrapTokenJti: string }) => Promise<boolean>;
  updateSandboxInstanceStatus: (input: UpdateSandboxInstanceStatusInput) => Promise<void>;
};

export function createStartSandboxInstanceWorkflow(
  ctx: CreateStartSandboxInstanceWorkflowInput,
): Workflow<
  StartSandboxInstanceWorkflowInput,
  StartSandboxInstanceWorkflowOutput,
  StartSandboxInstanceWorkflowInput
> {
  return defineWorkflow(
    StartSandboxInstanceWorkflowSpec,
    async ({ input: workflowInput, step }) => {
      async function handleFailedStartup(input: {
        sandboxInstanceId: string;
        provider: SandboxProvider;
        providerSandboxId: string;
        failureCode: string;
        failureMessage: string;
      }): Promise<void> {
        let stopSandboxError: unknown;
        try {
          await step.run({ name: "stop-sandbox-after-start-failure" }, async () => {
            await ctx.stopSandbox({
              provider: input.provider,
              providerSandboxId: input.providerSandboxId,
            });
          });
        } catch (error) {
          stopSandboxError = error;
        }

        let updateFailedStatusError: unknown;
        try {
          await step.run({ name: "mark-sandbox-instance-failed" }, async () => {
            await ctx.updateSandboxInstanceStatus({
              sandboxInstanceId: input.sandboxInstanceId,
              status: "failed",
              failureCode: input.failureCode,
              failureMessage: input.failureMessage,
            });
          });
        } catch (error) {
          updateFailedStatusError = error;
        }

        if (stopSandboxError !== undefined && updateFailedStatusError !== undefined) {
          throw new Error(
            "Failed to stop sandbox and failed to mark sandbox instance as failed after startup failure.",
            {
              cause: {
                stopSandboxError,
                updateFailedStatusError,
              },
            },
          );
        }

        if (stopSandboxError !== undefined) {
          throw new Error("Failed to stop sandbox after startup failure.", {
            cause: stopSandboxError,
          });
        }

        if (updateFailedStatusError !== undefined) {
          throw new Error("Failed to mark sandbox instance as failed after startup failure.", {
            cause: updateFailedStatusError,
          });
        }
      }

      const startedSandbox = await step.run({ name: "start-sandbox" }, async () => {
        return ctx.startSandbox({
          image: workflowInput.image,
        });
      });

      let persistedSandboxInstance: {
        sandboxInstanceId: string;
      };
      try {
        persistedSandboxInstance = await step.run({ name: "insert-sandbox-instance" }, async () => {
          return ctx.insertSandboxInstance({
            organizationId: workflowInput.organizationId,
            sandboxProfileId: workflowInput.sandboxProfileId,
            sandboxProfileVersion: workflowInput.sandboxProfileVersion,
            provider: startedSandbox.provider,
            providerSandboxId: startedSandbox.providerSandboxId,
            startedBy: workflowInput.startedBy,
            source: workflowInput.source,
          });
        });
      } catch (error) {
        await step.run({ name: "rollback-stop-sandbox" }, async () => {
          await ctx.stopSandbox({
            provider: startedSandbox.provider,
            providerSandboxId: startedSandbox.providerSandboxId,
          });
        });

        throw new Error(
          "Failed to persist sandbox instance after provider sandbox start. Provider sandbox was stopped.",
          { cause: error },
        );
      }

      let didSandboxConnectToTunnel: boolean;
      try {
        didSandboxConnectToTunnel = await step.run(
          { name: "wait-for-sandbox-tunnel-connect-ack" },
          async () => {
            return ctx.waitForSandboxTunnelConnectAck({
              bootstrapTokenJti: startedSandbox.bootstrapTokenJti,
            });
          },
        );
      } catch (error) {
        try {
          await handleFailedStartup({
            sandboxInstanceId: persistedSandboxInstance.sandboxInstanceId,
            provider: startedSandbox.provider,
            providerSandboxId: startedSandbox.providerSandboxId,
            failureCode: StartSandboxFailureCodes.TUNNEL_CONNECT_ACK_WAIT_FAILED,
            failureMessage: "Failed to wait for sandbox tunnel connect acknowledgement.",
          });
        } catch (cleanupError) {
          throw new Error(
            "Failed to wait for sandbox tunnel connect acknowledgement and failed cleanup after startup failure.",
            {
              cause: {
                waitForAckError: error,
                cleanupError,
              },
            },
          );
        }

        throw new Error(
          "Failed to wait for sandbox tunnel connect acknowledgement. Sandbox was stopped and sandbox instance was marked as failed.",
          {
            cause: error,
          },
        );
      }

      if (!didSandboxConnectToTunnel) {
        try {
          await handleFailedStartup({
            sandboxInstanceId: persistedSandboxInstance.sandboxInstanceId,
            provider: startedSandbox.provider,
            providerSandboxId: startedSandbox.providerSandboxId,
            failureCode: StartSandboxFailureCodes.TUNNEL_CONNECT_ACK_TIMEOUT,
            failureMessage: "Sandbox tunnel connect acknowledgement timed out.",
          });
        } catch (cleanupError) {
          throw new Error(
            "Sandbox tunnel connect acknowledgement timed out and failed cleanup after startup failure.",
            {
              cause: cleanupError,
            },
          );
        }

        throw new Error(
          "Sandbox tunnel connect acknowledgement timed out. Sandbox was stopped and sandbox instance was marked as failed.",
        );
      }

      try {
        await step.run({ name: "mark-sandbox-instance-running" }, async () => {
          await ctx.updateSandboxInstanceStatus({
            sandboxInstanceId: persistedSandboxInstance.sandboxInstanceId,
            status: "running",
          });
        });
      } catch (error) {
        try {
          await handleFailedStartup({
            sandboxInstanceId: persistedSandboxInstance.sandboxInstanceId,
            provider: startedSandbox.provider,
            providerSandboxId: startedSandbox.providerSandboxId,
            failureCode: StartSandboxFailureCodes.STATUS_TRANSITION_TO_RUNNING_FAILED,
            failureMessage:
              "Failed to transition sandbox instance status from starting to running.",
          });
        } catch (cleanupError) {
          throw new Error(
            "Failed to transition sandbox instance to running and failed cleanup after startup failure.",
            {
              cause: {
                markRunningError: error,
                cleanupError,
              },
            },
          );
        }

        throw new Error(
          "Failed to transition sandbox instance status from starting to running. Sandbox was stopped and sandbox instance was marked as failed.",
          {
            cause: error,
          },
        );
      }

      return {
        sandboxInstanceId: persistedSandboxInstance.sandboxInstanceId,
        providerSandboxId: startedSandbox.providerSandboxId,
      };
    },
  );
}
