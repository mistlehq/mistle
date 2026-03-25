import type { SandboxProvider } from "@mistle/sandbox";
import {
  StartSandboxInstanceWorkflowSpec,
  type StartSandboxInstanceWorkflowOutput,
} from "@mistle/workflow-registry/data-plane";
import { defineWorkflow } from "openworkflow";

import { getWorkflowContext } from "../core/context.js";
import { destroySandbox } from "../shared/destroy-sandbox.js";
import { applySandboxStartupConfiguration } from "./apply-sandbox-startup-configuration.js";
import { ensureSandboxInstance } from "./ensure-sandbox-instance.js";
import { markSandboxInstanceFailed } from "./mark-sandbox-instance-failed.js";
import { markSandboxInstanceRunning } from "./mark-sandbox-instance-running.js";
import { persistSandboxInstanceProvisioning } from "./persist-sandbox-instance-provisioning.js";
import { startSandbox } from "./start-sandbox.js";
import { waitForSandboxTunnelReadiness } from "./wait-for-sandbox-tunnel-readiness.js";

const StartSandboxFailureCodes = {
  SANDBOX_START_FAILED: "sandbox_start_failed",
  PERSIST_PROVISIONING_METADATA_FAILED: "persist_provisioning_metadata_failed",
  STARTUP_CONFIGURATION_FAILED: "startup_configuration_failed",
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
      providerSandboxId?: string;
      failureCode: string;
      failureMessage: string;
    }): Promise<void> {
      let destroySandboxError: unknown;
      if (input.runtimeProvider !== undefined && input.providerSandboxId !== undefined) {
        const runtimeProvider = input.runtimeProvider;
        const providerSandboxId = input.providerSandboxId;
        try {
          await step.run({ name: "destroy-sandbox-after-start-failure" }, async () => {
            await destroySandbox(
              {
                config: ctx.config,
                sandboxAdapter: ctx.sandboxAdapter,
              },
              {
                runtimeProvider,
                providerSandboxId,
              },
            );
          });
        } catch (error) {
          destroySandboxError = error;
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

      if (destroySandboxError !== undefined && updateFailedStatusError !== undefined) {
        throw new Error(
          "Failed to destroy sandbox and failed to mark sandbox instance as failed after startup failure.",
          {
            cause: {
              destroySandboxError,
              updateFailedStatusError,
            },
          },
        );
      }

      if (destroySandboxError !== undefined) {
        throw new Error("Failed to destroy sandbox after startup failure.", {
          cause: destroySandboxError,
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
      providerSandboxId: string;
    };

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
            providerSandboxId: startedSandbox.providerSandboxId,
          },
        );
      });
    } catch (error) {
      try {
        await handleFailedStartup({
          sandboxInstanceId: ensuredSandboxInstance.sandboxInstanceId,
          runtimeProvider: startedSandbox.runtimeProvider,
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

    try {
      await step.run({ name: "apply-sandbox-startup-configuration" }, async () => {
        await applySandboxStartupConfiguration(
          {
            config: ctx.config,
            startupConfigurator: ctx.startupConfigurator,
          },
          {
            sandboxInstanceId: startedSandbox.sandboxInstanceId,
            runtimeProvider: startedSandbox.runtimeProvider,
            providerSandboxId: startedSandbox.providerSandboxId,
            runtimePlan: workflowInput.runtimePlan,
          },
        );
      });
    } catch (error) {
      try {
        await handleFailedStartup({
          sandboxInstanceId: ensuredSandboxInstance.sandboxInstanceId,
          runtimeProvider: startedSandbox.runtimeProvider,
          providerSandboxId: startedSandbox.providerSandboxId,
          failureCode: StartSandboxFailureCodes.STARTUP_CONFIGURATION_FAILED,
          failureMessage: "Failed to apply sandbox startup configuration.",
        });
      } catch (cleanupError) {
        throw new Error(
          "Failed to apply sandbox startup configuration and failed cleanup after startup failure.",
          {
            cause: {
              applyStartupConfigurationError: error,
              cleanupError,
            },
          },
        );
      }

      throw new Error(
        "Failed to apply sandbox startup configuration. Sandbox was stopped and sandbox instance was marked as failed.",
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
              runtimeStateReader: ctx.runtimeStateReader,
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
          providerSandboxId: startedSandbox.providerSandboxId,
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
          providerSandboxId: startedSandbox.providerSandboxId,
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
