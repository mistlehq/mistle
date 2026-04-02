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
import { SandboxStartupModes } from "./sandbox-startup-input.js";
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
    const logger = ctx.logger.child({
      workflow: StartSandboxInstanceWorkflowSpec.name,
      sandboxInstanceId: workflowInput.sandboxInstanceId,
      organizationId: workflowInput.organizationId,
      sandboxProfileId: workflowInput.sandboxProfileId,
      sandboxProfileVersion: workflowInput.sandboxProfileVersion,
      startedBy: workflowInput.startedBy,
      source: workflowInput.source,
    });

    async function markSandboxInstanceFailedStep(input: {
      sandboxInstanceId: string;
      failureCode: string;
      failureMessage: string;
    }): Promise<void> {
      logger.warn(
        {
          failureCode: input.failureCode,
          failureMessage: input.failureMessage,
        },
        "Marking sandbox instance as failed during start workflow.",
      );
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
        logger.warn(
          {
            failureCode: input.failureCode,
            runtimeProvider,
            providerSandboxId,
          },
          "Cleaning up sandbox after start failure.",
        );
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
          logger.error(
            {
              err: error,
              failureCode: input.failureCode,
              runtimeProvider,
              providerSandboxId,
            },
            "Failed to destroy sandbox during start failure cleanup.",
          );
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
        logger.error(
          {
            err: error,
            failureCode: input.failureCode,
          },
          "Failed to update sandbox instance status during start failure cleanup.",
        );
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
      logger.info("Ensuring sandbox instance exists before sandbox startup.");
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

      logger.info("Ensured sandbox instance exists.");
      return persisted;
    });

    let startedSandbox: {
      sandboxInstanceId: string;
      runtimeProvider: SandboxProvider;
      providerSandboxId: string;
    };

    try {
      startedSandbox = await step.run({ name: "start-sandbox" }, async () => {
        logger.info(
          {
            image: workflowInput.image,
            runtimeProvider: ctx.config.sandbox.provider,
          },
          "Starting sandbox with provider.",
        );
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
      logger.info(
        {
          runtimeProvider: startedSandbox.runtimeProvider,
          providerSandboxId: startedSandbox.providerSandboxId,
        },
        "Sandbox provider start completed.",
      );
    } catch (error) {
      logger.error({ err: error }, "Sandbox provider start failed.");
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
        logger.info(
          {
            providerSandboxId: startedSandbox.providerSandboxId,
          },
          "Persisting sandbox provisioning metadata.",
        );
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
      logger.info(
        {
          providerSandboxId: startedSandbox.providerSandboxId,
        },
        "Persisted sandbox provisioning metadata.",
      );
    } catch (error) {
      logger.error(
        {
          err: error,
          providerSandboxId: startedSandbox.providerSandboxId,
        },
        "Failed to persist sandbox provisioning metadata.",
      );
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
        logger.info(
          {
            providerSandboxId: startedSandbox.providerSandboxId,
          },
          "Applying sandbox startup configuration.",
        );
        await applySandboxStartupConfiguration(
          {
            config: ctx.config,
            sandboxRuntimeControl: ctx.sandboxRuntimeControl,
          },
          {
            sandboxInstanceId: startedSandbox.sandboxInstanceId,
            providerSandboxId: startedSandbox.providerSandboxId,
            startupMode: SandboxStartupModes.NEW,
            runtimePlan: workflowInput.runtimePlan,
          },
        );
      });
      logger.info(
        {
          providerSandboxId: startedSandbox.providerSandboxId,
        },
        "Applied sandbox startup configuration.",
      );
    } catch (error) {
      logger.error(
        {
          err: error,
          providerSandboxId: startedSandbox.providerSandboxId,
        },
        "Failed to apply sandbox startup configuration.",
      );
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
          logger.info(
            {
              providerSandboxId: startedSandbox.providerSandboxId,
              timeoutMs: ctx.tunnelReadinessPolicy.timeoutMs,
              pollIntervalMs: ctx.tunnelReadinessPolicy.pollIntervalMs,
            },
            "Waiting for sandbox tunnel readiness.",
          );
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
      logger.info(
        {
          providerSandboxId: startedSandbox.providerSandboxId,
          didSandboxConnectToTunnel,
        },
        "Finished waiting for sandbox tunnel readiness.",
      );
    } catch (error) {
      logger.error(
        {
          err: error,
          providerSandboxId: startedSandbox.providerSandboxId,
        },
        "Failed while waiting for sandbox tunnel readiness.",
      );
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
      logger.error(
        {
          providerSandboxId: startedSandbox.providerSandboxId,
          timeoutMs: ctx.tunnelReadinessPolicy.timeoutMs,
        },
        "Sandbox tunnel readiness timed out.",
      );
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
        logger.info(
          {
            providerSandboxId: startedSandbox.providerSandboxId,
          },
          "Marking sandbox instance as running.",
        );
        await markSandboxInstanceRunning(
          {
            db: ctx.db,
          },
          {
            sandboxInstanceId: ensuredSandboxInstance.sandboxInstanceId,
          },
        );
      });
      logger.info(
        {
          providerSandboxId: startedSandbox.providerSandboxId,
        },
        "Sandbox start workflow completed successfully.",
      );
    } catch (error) {
      logger.error(
        {
          err: error,
          providerSandboxId: startedSandbox.providerSandboxId,
        },
        "Failed to mark sandbox instance as running.",
      );
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
