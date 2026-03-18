import type { SandboxProvider } from "@mistle/sandbox";
import {
  StartSandboxInstanceWorkflowSpec,
  type StartSandboxInstanceWorkflowOutput,
} from "@mistle/workflow-registry/data-plane";
import { defineWorkflow } from "openworkflow";

import { getWorkflowContext } from "../core/context.js";
import { stopSandbox } from "../shared/stop-sandbox.js";
import { ensureSandboxInstance } from "./ensure-sandbox-instance.js";
import { markSandboxInstanceFailed } from "./mark-sandbox-instance-failed.js";
import { markSandboxInstanceRunning } from "./mark-sandbox-instance-running.js";
import { persistSandboxInstanceProvisioning } from "./persist-sandbox-instance-provisioning.js";
import { persistSandboxInstanceVolumeProvisioning } from "./persist-sandbox-instance-volume-provisioning.js";
import {
  provisionInstanceVolume,
  type ProvisionedInstanceVolume,
} from "./provision-instance-volume.js";
import { startSandbox } from "./start-sandbox.js";
import { waitForSandboxTunnelReadiness } from "./wait-for-sandbox-tunnel-readiness.js";

const StartSandboxFailureCodes = {
  INSTANCE_VOLUME_PROVISION_FAILED: "instance_volume_provision_failed",
  PERSIST_INSTANCE_VOLUME_METADATA_FAILED: "persist_instance_volume_metadata_failed",
  SANDBOX_START_FAILED: "sandbox_start_failed",
  PERSIST_PROVISIONING_METADATA_FAILED: "persist_provisioning_metadata_failed",
  TUNNEL_CONNECT_ACK_TIMEOUT: "tunnel_connect_ack_timeout",
  TUNNEL_CONNECT_ACK_WAIT_FAILED: "tunnel_connect_ack_wait_failed",
  STATUS_TRANSITION_TO_RUNNING_FAILED: "status_transition_to_running_failed",
} as const;

export const StartSandboxInstanceWorkflow = defineWorkflow(
  StartSandboxInstanceWorkflowSpec,
  async ({ input: workflowInput, step }): Promise<StartSandboxInstanceWorkflowOutput> => {
    const ctx = await getWorkflowContext();

    async function markSandboxInstanceFailedStep(input: {
      sandboxInstanceId: string;
      failureCode: string;
      failureMessage: string;
    }): Promise<void> {
      await step.run({ name: "mark-sandbox-instance-failed" }, async () => {
        await markSandboxInstanceFailed(
          {
            db: ctx.db,
          },
          input,
        );
      });
    }

    async function handleFailedStartup(input: {
      sandboxInstanceId: string;
      runtimeProvider?: SandboxProvider;
      providerRuntimeId?: string;
      failureCode: string;
      failureMessage: string;
    }): Promise<void> {
      let stopSandboxError: unknown;
      if (input.runtimeProvider !== undefined && input.providerRuntimeId !== undefined) {
        const runtimeProvider = input.runtimeProvider;
        const providerRuntimeId = input.providerRuntimeId;
        try {
          await step.run({ name: "stop-sandbox-after-start-failure" }, async () => {
            await stopSandbox(
              {
                config: ctx.config,
                sandboxAdapter: ctx.sandboxAdapter,
              },
              {
                runtimeProvider,
                providerRuntimeId,
              },
            );
          });
        } catch (error) {
          stopSandboxError = error;
        }
      }

      let updateFailedStatusError: unknown;
      try {
        await markSandboxInstanceFailedStep({
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

    async function handleFailedBeforeRuntimeStart(input: {
      sandboxInstanceId: string;
      instanceVolumeId?: string;
      failureCode: string;
      failureMessage: string;
    }): Promise<void> {
      let deleteVolumeError: unknown;
      const instanceVolumeId = input.instanceVolumeId;
      if (instanceVolumeId !== undefined) {
        try {
          await step.run({ name: "delete-instance-volume-after-startup-failure" }, async () => {
            await ctx.sandboxAdapter.deleteVolume({
              volumeId: instanceVolumeId,
            });
          });
        } catch (error) {
          deleteVolumeError = error;
        }
      }

      let updateFailedStatusError: unknown;
      try {
        await markSandboxInstanceFailedStep({
          sandboxInstanceId: input.sandboxInstanceId,
          failureCode: input.failureCode,
          failureMessage: input.failureMessage,
        });
      } catch (error) {
        updateFailedStatusError = error;
      }

      if (deleteVolumeError !== undefined && updateFailedStatusError !== undefined) {
        throw new Error(
          "Failed to delete instance volume and failed to mark sandbox instance as failed before runtime start.",
          {
            cause: {
              deleteVolumeError,
              updateFailedStatusError,
            },
          },
        );
      }

      if (deleteVolumeError !== undefined) {
        throw new Error("Failed to delete instance volume before runtime start failure.", {
          cause: deleteVolumeError,
        });
      }

      if (updateFailedStatusError !== undefined) {
        throw new Error("Failed to mark sandbox instance as failed before runtime start failure.", {
          cause: updateFailedStatusError,
        });
      }
    }

    const ensuredSandboxInstance = await step.run({ name: "ensure-sandbox-instance" }, async () => {
      const persisted = await ensureSandboxInstance(
        {
          db: ctx.db,
          runtimeProvider: ctx.config.sandbox.provider,
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
      runtimeProvider: SandboxProvider;
      providerRuntimeId: string;
    };
    let provisionedInstanceVolume: ProvisionedInstanceVolume;
    try {
      provisionedInstanceVolume = await step.run(
        { name: "provision-instance-volume" },
        async () => {
          return provisionInstanceVolume({
            runtimeProvider: ctx.config.sandbox.provider,
            sandboxAdapter: ctx.sandboxAdapter,
          });
        },
      );
    } catch (error) {
      await markSandboxInstanceFailedStep({
        sandboxInstanceId: ensuredSandboxInstance.sandboxInstanceId,
        failureCode: StartSandboxFailureCodes.INSTANCE_VOLUME_PROVISION_FAILED,
        failureMessage: "Failed to provision instance volume before runtime startup.",
      });
      throw error;
    }

    try {
      await step.run({ name: "persist-instance-volume-metadata" }, async () => {
        await persistSandboxInstanceVolumeProvisioning(
          {
            db: ctx.db,
          },
          {
            sandboxInstanceId: ensuredSandboxInstance.sandboxInstanceId,
            instanceVolumeProvider: provisionedInstanceVolume.instanceVolumeProvider,
            instanceVolumeId: provisionedInstanceVolume.instanceVolumeId,
            instanceVolumeMode: provisionedInstanceVolume.instanceVolumeMode,
          },
        );
      });
    } catch (error) {
      try {
        await handleFailedBeforeRuntimeStart({
          sandboxInstanceId: ensuredSandboxInstance.sandboxInstanceId,
          instanceVolumeId: provisionedInstanceVolume.instanceVolumeId,
          failureCode: StartSandboxFailureCodes.PERSIST_INSTANCE_VOLUME_METADATA_FAILED,
          failureMessage:
            "Failed to persist sandbox instance volume metadata before runtime startup.",
        });
      } catch (cleanupError) {
        throw new Error(
          "Failed to persist instance volume metadata and failed cleanup before runtime start.",
          {
            cause: {
              persistInstanceVolumeError: error,
              cleanupError,
            },
          },
        );
      }

      throw new Error(
        "Failed to persist instance volume metadata. Sandbox instance was marked as failed.",
        {
          cause: error,
        },
      );
    }

    try {
      startedSandbox = await step.run({ name: "start-sandbox" }, async () => {
        return startSandbox(
          {
            config: ctx.config,
            sandboxAdapter: ctx.sandboxAdapter,
          },
          {
            sandboxInstanceId: workflowInput.sandboxInstanceId,
            image: workflowInput.image,
            instanceVolume: provisionedInstanceVolume.handle,
            instanceVolumeMode: provisionedInstanceVolume.instanceVolumeMode,
            runtimePlan: workflowInput.runtimePlan,
          },
        );
      });
    } catch (error) {
      await markSandboxInstanceFailedStep({
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
            db: ctx.db,
          },
          {
            sandboxInstanceId: startedSandbox.sandboxInstanceId,
            runtimePlan: workflowInput.runtimePlan,
            sandboxProfileId: workflowInput.sandboxProfileId,
            sandboxProfileVersion: workflowInput.sandboxProfileVersion,
            providerRuntimeId: startedSandbox.providerRuntimeId,
          },
        );
      });
    } catch (error) {
      try {
        await handleFailedStartup({
          sandboxInstanceId: ensuredSandboxInstance.sandboxInstanceId,
          runtimeProvider: startedSandbox.runtimeProvider,
          providerRuntimeId: startedSandbox.providerRuntimeId,
          failureCode: StartSandboxFailureCodes.PERSIST_PROVISIONING_METADATA_FAILED,
          failureMessage: "Failed to persist sandbox runtime plan and provider runtime metadata.",
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
        { name: "wait-for-sandbox-tunnel-readiness" },
        async () => {
          return waitForSandboxTunnelReadiness(
            {
              db: ctx.db,
              policy: ctx.tunnelReadinessPolicy,
              clock: ctx.clock,
              sleeper: ctx.sleeper,
            },
            {
              sandboxInstanceId: startedSandbox.sandboxInstanceId,
            },
          );
        },
      );
    } catch (error) {
      try {
        await handleFailedStartup({
          sandboxInstanceId: ensuredSandboxInstance.sandboxInstanceId,
          runtimeProvider: startedSandbox.runtimeProvider,
          providerRuntimeId: startedSandbox.providerRuntimeId,
          failureCode: StartSandboxFailureCodes.TUNNEL_CONNECT_ACK_WAIT_FAILED,
          failureMessage: "Failed to wait for sandbox tunnel readiness.",
        });
      } catch (cleanupError) {
        throw new Error(
          "Failed to wait for sandbox tunnel readiness and failed cleanup after startup failure.",
          {
            cause: {
              waitForAckError: error,
              cleanupError,
            },
          },
        );
      }

      throw new Error(
        "Failed to wait for sandbox tunnel readiness. Sandbox was stopped and sandbox instance was marked as failed.",
        {
          cause: error,
        },
      );
    }

    if (!didSandboxConnectToTunnel) {
      try {
        await handleFailedStartup({
          sandboxInstanceId: ensuredSandboxInstance.sandboxInstanceId,
          runtimeProvider: startedSandbox.runtimeProvider,
          providerRuntimeId: startedSandbox.providerRuntimeId,
          failureCode: StartSandboxFailureCodes.TUNNEL_CONNECT_ACK_TIMEOUT,
          failureMessage: "Sandbox tunnel readiness timed out.",
        });
      } catch (cleanupError) {
        throw new Error(
          "Sandbox tunnel readiness timed out and failed cleanup after startup failure.",
          {
            cause: cleanupError,
          },
        );
      }

      throw new Error(
        "Sandbox tunnel readiness timed out. Sandbox was stopped and sandbox instance was marked as failed.",
      );
    }

    try {
      await step.run({ name: "mark-sandbox-instance-running" }, async () => {
        await markSandboxInstanceRunning(
          {
            db: ctx.db,
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
          runtimeProvider: startedSandbox.runtimeProvider,
          providerRuntimeId: startedSandbox.providerRuntimeId,
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
      providerRuntimeId: startedSandbox.providerRuntimeId,
    };
  },
);
