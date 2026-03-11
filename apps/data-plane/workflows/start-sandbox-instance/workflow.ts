import type { StartSandboxInstanceInput } from "@mistle/data-plane-trpc/contracts";
import type { SandboxProvider } from "@mistle/sandbox";
import type { SandboxImageHandle } from "@mistle/sandbox";
import { systemClock, systemSleeper } from "@mistle/time";
import { defineWorkflow, defineWorkflowSpec } from "openworkflow";

import {
  ensureSandboxInstance,
  persistSandboxInstanceProvisioning,
} from "../../src/worker/runtime/services/insert-sandbox-instance.js";
import { startSandbox } from "../../src/worker/runtime/services/start-sandbox.js";
import { stopSandbox } from "../../src/worker/runtime/services/stop-sandbox.js";
import {
  markSandboxInstanceFailed,
  markSandboxInstanceRunning,
} from "../../src/worker/runtime/services/update-sandbox-instance-status.js";
import { waitForSandboxTunnelConnectAck } from "../../src/worker/runtime/services/wait-for-sandbox-tunnel-connect-ack.js";
import { getDataPlaneWorkflowRuntime } from "../runtime-context.js";

const StartSandboxFailureCodes = {
  SANDBOX_START_FAILED: "sandbox_start_failed",
  PERSIST_PROVISIONING_METADATA_FAILED: "persist_provisioning_metadata_failed",
  TUNNEL_CONNECT_ACK_TIMEOUT: "tunnel_connect_ack_timeout",
  TUNNEL_CONNECT_ACK_WAIT_FAILED: "tunnel_connect_ack_wait_failed",
  STATUS_TRANSITION_TO_RUNNING_FAILED: "status_transition_to_running_failed",
} as const;

export type StartSandboxInstanceWorkflowImageInput = Pick<
  SandboxImageHandle,
  "imageId" | "kind" | "createdAt"
>;

export type StartSandboxInstanceWorkflowInput = {
  sandboxInstanceId: string;
} & StartSandboxInstanceInput;

export type StartSandboxInstanceWorkflowOutput = {
  sandboxInstanceId: string;
  providerSandboxId: string;
};

export const StartSandboxInstanceWorkflow = defineWorkflow(
  defineWorkflowSpec<
    StartSandboxInstanceWorkflowInput,
    StartSandboxInstanceWorkflowOutput,
    StartSandboxInstanceWorkflowInput
  >({
    name: "data-plane.sandbox-instances.start",
    version: "1",
  }),
  async ({ input: workflowInput, step }) => {
    const runtime = await getDataPlaneWorkflowRuntime();

    async function markFailed(input: {
      sandboxInstanceId: string;
      failureCode: string;
      failureMessage: string;
    }): Promise<void> {
      await step.run({ name: "mark-sandbox-instance-failed" }, async () => {
        await markSandboxInstanceFailed(
          {
            db: runtime.db,
          },
          input,
        );
      });
    }

    async function handleFailedStartup(input: {
      sandboxInstanceId: string;
      provider?: SandboxProvider;
      providerSandboxId?: string;
      failureCode: string;
      failureMessage: string;
    }): Promise<void> {
      let stopSandboxError: unknown;
      if (input.provider !== undefined && input.providerSandboxId !== undefined) {
        const provider = input.provider;
        const providerSandboxId = input.providerSandboxId;
        try {
          await step.run({ name: "stop-sandbox-after-start-failure" }, async () => {
            await stopSandbox(
              {
                config: runtime.config,
                sandboxAdapter: runtime.sandboxAdapter,
              },
              {
                provider,
                providerSandboxId,
              },
            );
          });
        } catch (error) {
          stopSandboxError = error;
        }
      }

      let updateFailedStatusError: unknown;
      try {
        await markFailed({
          sandboxInstanceId: input.sandboxInstanceId,
          failureCode: input.failureCode,
          failureMessage: input.failureMessage,
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

    const ensuredSandboxInstance = await step.run({ name: "ensure-sandbox-instance" }, async () => {
      const persisted = await ensureSandboxInstance(
        {
          db: runtime.db,
          provider: runtime.config.sandbox.provider,
        },
        {
          sandboxInstanceId: workflowInput.sandboxInstanceId,
          organizationId: workflowInput.organizationId,
          sandboxProfileId: workflowInput.sandboxProfileId,
          sandboxProfileVersion: workflowInput.sandboxProfileVersion,
          startedBy: workflowInput.startedBy,
          source: workflowInput.source,
        },
      );

      if (persisted.sandboxInstanceId !== workflowInput.sandboxInstanceId) {
        throw new Error("Sandbox instance store returned an unexpected sandboxInstanceId.");
      }

      return persisted;
    });

    let startedSandbox: {
      sandboxInstanceId: string;
      provider: SandboxProvider;
      providerSandboxId: string;
      bootstrapTokenJti: string;
    };
    try {
      startedSandbox = await step.run({ name: "start-sandbox" }, async () =>
        startSandbox(
          {
            config: runtime.config,
            sandboxAdapter: runtime.sandboxAdapter,
          },
          {
            sandboxInstanceId: workflowInput.sandboxInstanceId,
            image: workflowInput.image,
            runtimePlan: workflowInput.runtimePlan,
          },
        ),
      );
    } catch (error) {
      await markFailed({
        sandboxInstanceId: ensuredSandboxInstance.sandboxInstanceId,
        failureCode: StartSandboxFailureCodes.SANDBOX_START_FAILED,
        failureMessage: "Sandbox provider start failed before runtime provisioning completed.",
      });
      throw error;
    }

    if (startedSandbox.sandboxInstanceId !== workflowInput.sandboxInstanceId) {
      throw new Error("Sandbox lifecycle start returned an unexpected sandboxInstanceId.");
    }

    try {
      await step.run({ name: "persist-sandbox-provisioning-metadata" }, async () => {
        await persistSandboxInstanceProvisioning(
          {
            db: runtime.db,
          },
          {
            sandboxInstanceId: startedSandbox.sandboxInstanceId,
            runtimePlan: workflowInput.runtimePlan,
            sandboxProfileId: workflowInput.sandboxProfileId,
            sandboxProfileVersion: workflowInput.sandboxProfileVersion,
            providerSandboxId: startedSandbox.providerSandboxId,
          },
        );
      });
    } catch (error) {
      try {
        await handleFailedStartup({
          sandboxInstanceId: ensuredSandboxInstance.sandboxInstanceId,
          provider: startedSandbox.provider,
          providerSandboxId: startedSandbox.providerSandboxId,
          failureCode: StartSandboxFailureCodes.PERSIST_PROVISIONING_METADATA_FAILED,
          failureMessage: "Failed to persist sandbox runtime plan and provider sandbox metadata.",
        });
      } catch (cleanupError) {
        throw new Error(
          "Failed to persist sandbox provisioning metadata and failed cleanup after startup failure.",
          {
            cause: {
              persistProvisioningError: error,
              cleanupError,
            },
          },
        );
      }

      throw new Error(
        "Failed to persist sandbox provisioning metadata. Sandbox was stopped and sandbox instance was marked as failed.",
        {
          cause: error,
        },
      );
    }

    let didSandboxConnectToTunnel: boolean;
    try {
      didSandboxConnectToTunnel = await step.run(
        { name: "wait-for-sandbox-tunnel-connect-ack" },
        async () =>
          waitForSandboxTunnelConnectAck(
            {
              db: runtime.db,
              policy: runtime.tunnelConnectAckPolicy,
              clock: systemClock,
              sleeper: systemSleeper,
            },
            {
              bootstrapTokenJti: startedSandbox.bootstrapTokenJti,
            },
          ),
      );
    } catch (error) {
      try {
        await handleFailedStartup({
          sandboxInstanceId: ensuredSandboxInstance.sandboxInstanceId,
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
          sandboxInstanceId: ensuredSandboxInstance.sandboxInstanceId,
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
        await markSandboxInstanceRunning(
          {
            db: runtime.db,
          },
          {
            sandboxInstanceId: ensuredSandboxInstance.sandboxInstanceId,
          },
        );
      });
    } catch (error) {
      try {
        await handleFailedStartup({
          sandboxInstanceId: ensuredSandboxInstance.sandboxInstanceId,
          provider: startedSandbox.provider,
          providerSandboxId: startedSandbox.providerSandboxId,
          failureCode: StartSandboxFailureCodes.STATUS_TRANSITION_TO_RUNNING_FAILED,
          failureMessage: "Failed to transition sandbox instance status from starting to running.",
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
      sandboxInstanceId: ensuredSandboxInstance.sandboxInstanceId,
      providerSandboxId: startedSandbox.providerSandboxId,
    };
  },
);

export const StartSandboxInstanceWorkflowSpec = StartSandboxInstanceWorkflow.spec;
