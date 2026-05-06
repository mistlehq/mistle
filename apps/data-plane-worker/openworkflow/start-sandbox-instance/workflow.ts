import type { SandboxProvider } from "@mistle/sandbox";
import {
  StartSandboxInstanceWorkflowSpec,
  type StartSandboxInstanceWorkflowOutput,
} from "@mistle/workflow-registry/data-plane";

import { getWorkflowContext } from "../core/context.js";
import { defineTracedDataPlaneWorkflow } from "../core/tracing.js";
import { attachSandboxStorage } from "../shared/attach-sandbox-storage.js";
import { destroySandbox } from "../shared/destroy-sandbox.js";
import { formatPersistedFailureMessage } from "../shared/format-persisted-failure-message.js";
import { prepareSandboxStorageForStart } from "../shared/prepare-sandbox-storage-for-start.js";
import { emitSandboxStartupDiagnostics } from "../shared/sandbox-startup-diagnostics.js";
import { createSandboxStorageBackendAdapter } from "../shared/sandbox-storage/create-sandbox-storage-backend-adapter.js";
import { ensureSandboxInstance } from "./ensure-sandbox-instance.js";
import { initializeSandboxRuntime } from "./initialize-sandbox-runtime.js";
import { markSandboxInstanceFailed } from "./mark-sandbox-instance-failed.js";
import { markSandboxInstanceRunning } from "./mark-sandbox-instance-running.js";
import { persistSandboxInstanceProvisioning } from "./persist-sandbox-instance-provisioning.js";
import { SandboxExecutionModes, SandboxStartupModes } from "./sandbox-startup-input.js";
import { startSandbox } from "./start-sandbox.js";
import { waitForSandboxRuntimeReadiness } from "./wait-for-sandbox-runtime-readiness.js";

const StartSandboxFailureCodes = {
  SANDBOX_STORAGE_PROVISION_FAILED: "sandbox_storage_provision_failed",
  SANDBOX_STORAGE_PREPARE_FAILED: "sandbox_storage_prepare_failed",
  SANDBOX_START_FAILED: "sandbox_start_failed",
  PERSIST_PROVISIONING_METADATA_FAILED: "persist_provisioning_metadata_failed",
  SANDBOX_INIT_FAILED: "sandbox_init_failed",
  TUNNEL_CONNECT_ACK_TIMEOUT: "tunnel_connect_ack_timeout",
  TUNNEL_CONNECT_ACK_WAIT_FAILED: "tunnel_connect_ack_wait_failed",
  STATUS_TRANSITION_TO_RUNNING_FAILED: "status_transition_to_running_failed",
} as const;

export const StartSandboxInstanceWorkflow = defineTracedDataPlaneWorkflow(
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
            tables: ctx.tables,
          },
          {
            ...input,
            allowStoppedCurrentStatus: true,
          },
        );
      });
    }

    async function handleFailedStartup(input: {
      sandboxInstanceId: string;
      persistenceMode: (typeof workflowInput)["persistenceMode"];
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
                db: ctx.db,
                tables: ctx.tables,
                controlPlaneInternalClient: ctx.controlPlaneInternalClient,
                config: ctx.config,
                sandboxAdapter: ctx.sandboxAdapter,
              },
              {
                sandboxInstanceId: input.sandboxInstanceId,
                organizationId: workflowInput.organizationId,
                persistenceMode: input.persistenceMode,
                runtimeProvider,
                providerSandboxId,
                skipPersistentStorageDeprovision: true,
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

      let deprovisionSandboxStorageError: unknown;
      if (input.persistenceMode === "persistent") {
        logger.warn(
          {
            failureCode: input.failureCode,
          },
          "Deprovisioning persistent sandbox storage after start failure.",
        );
        try {
          await step.run({ name: "deprovision-sandbox-storage-after-start-failure" }, async () => {
            const storageBackendAdapter = createSandboxStorageBackendAdapter({
              db: ctx.db,
              tables: ctx.tables,
              controlPlaneInternalClient: ctx.controlPlaneInternalClient,
              workerConfig: ctx.config.app,
              runtimeProvider: ctx.config.sandbox.provider,
              storageBackend: ctx.config.sandbox.storage?.backend,
            });
            await storageBackendAdapter.deprovision({
              organizationId: workflowInput.organizationId,
              sandboxInstanceId: input.sandboxInstanceId,
            });
          });
        } catch (error) {
          logger.error(
            {
              err: error,
              failureCode: input.failureCode,
            },
            "Failed to deprovision sandbox storage during start failure cleanup.",
          );
          deprovisionSandboxStorageError = error;
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

      if (
        destroySandboxError !== undefined &&
        deprovisionSandboxStorageError !== undefined &&
        updateFailedStatusError !== undefined
      ) {
        throw new Error(
          "Failed to destroy sandbox, failed to deprovision sandbox storage, and failed to mark sandbox instance as failed after startup failure.",
          {
            cause: {
              destroySandboxError,
              deprovisionSandboxStorageError,
              updateFailedStatusError,
            },
          },
        );
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

      if (deprovisionSandboxStorageError !== undefined && updateFailedStatusError !== undefined) {
        throw new Error(
          "Failed to deprovision sandbox storage and failed to mark sandbox instance as failed after startup failure.",
          {
            cause: {
              deprovisionSandboxStorageError,
              updateFailedStatusError,
            },
          },
        );
      }

      if (destroySandboxError !== undefined && deprovisionSandboxStorageError !== undefined) {
        throw new Error(
          "Failed to destroy sandbox and failed to deprovision sandbox storage after startup failure.",
          {
            cause: {
              destroySandboxError,
              deprovisionSandboxStorageError,
            },
          },
        );
      }

      if (destroySandboxError !== undefined) {
        throw new Error("Failed to destroy sandbox after startup failure.", {
          cause: destroySandboxError,
        });
      }

      if (deprovisionSandboxStorageError !== undefined) {
        throw new Error("Failed to deprovision sandbox storage after startup failure.", {
          cause: deprovisionSandboxStorageError,
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
          tables: ctx.tables,
          runtimeProvider: ctx.config.sandbox.provider,
        },
        {
          sandboxInstanceId: workflowInput.sandboxInstanceId,
          organizationId: workflowInput.organizationId,
          sandboxProfileId: workflowInput.sandboxProfileId,
          sandboxProfileVersion: workflowInput.sandboxProfileVersion,
          persistenceMode: workflowInput.persistenceMode,
          purpose: workflowInput.purpose,
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

    if (workflowInput.persistenceMode === "persistent") {
      try {
        await step.run({ name: "provision-sandbox-storage" }, async () => {
          logger.info("Provisioning persistent sandbox storage.");
          const storageBackendAdapter = createSandboxStorageBackendAdapter({
            db: ctx.db,
            tables: ctx.tables,
            controlPlaneInternalClient: ctx.controlPlaneInternalClient,
            workerConfig: ctx.config.app,
            runtimeProvider: ctx.config.sandbox.provider,
            storageBackend: ctx.config.sandbox.storage?.backend,
          });
          await storageBackendAdapter.provision({
            organizationId: workflowInput.organizationId,
            sandboxInstanceId: workflowInput.sandboxInstanceId,
          });
        });
        logger.info("Provisioned persistent sandbox storage.");
      } catch (error) {
        logger.error({ err: error }, "Persistent sandbox storage provisioning failed.");
        await markSandboxInstanceFailedStep({
          sandboxInstanceId: ensuredSandboxInstance.sandboxInstanceId,
          failureCode: StartSandboxFailureCodes.SANDBOX_STORAGE_PROVISION_FAILED,
          failureMessage: formatPersistedFailureMessage({
            summary: "Persistent sandbox storage provisioning failed before sandbox startup.",
            error,
          }),
        });
        throw error;
      }
    }

    let startedSandbox: {
      sandboxInstanceId: string;
      runtimeProvider: SandboxProvider;
      providerSandboxId: string;
    };
    let storagePreparation;
    try {
      storagePreparation = await step.run(
        { name: "prepare-sandbox-storage-for-start" },
        async () => {
          logger.info("Preparing sandbox storage before provider start.");
          return prepareSandboxStorageForStart(
            {
              db: ctx.db,
              tables: ctx.tables,
              controlPlaneInternalClient: ctx.controlPlaneInternalClient,
              workerConfig: ctx.config.app,
              configuredSandboxProvider: ctx.config.sandbox.provider,
              sandboxAdapter: ctx.sandboxAdapter,
              storageBackend: ctx.config.sandbox.storage?.backend,
            },
            {
              organizationId: workflowInput.organizationId,
              sandboxInstanceId: workflowInput.sandboxInstanceId,
              image: workflowInput.image,
              persistenceMode: workflowInput.persistenceMode,
              runtimeProvider: ctx.config.sandbox.provider,
            },
          );
        },
      );
      logger.info("Prepared sandbox storage before provider start.");
    } catch (error) {
      logger.error({ err: error }, "Sandbox storage preparation failed before provider start.");
      await handleFailedStartup({
        sandboxInstanceId: ensuredSandboxInstance.sandboxInstanceId,
        persistenceMode: workflowInput.persistenceMode,
        failureCode: StartSandboxFailureCodes.SANDBOX_STORAGE_PREPARE_FAILED,
        failureMessage: formatPersistedFailureMessage({
          summary: "Sandbox storage preparation failed before provider start.",
          error,
        }),
      });
      throw error;
    }

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
            processEnv: ctx.processEnv,
            sandboxAdapter: ctx.sandboxAdapter,
          },
          {
            sandboxInstanceId: workflowInput.sandboxInstanceId,
            image: workflowInput.image,
            storagePreparation,
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
      await handleFailedStartup({
        sandboxInstanceId: ensuredSandboxInstance.sandboxInstanceId,
        persistenceMode: workflowInput.persistenceMode,
        failureCode: StartSandboxFailureCodes.SANDBOX_START_FAILED,
        failureMessage: formatPersistedFailureMessage({
          summary: "Sandbox provider start failed before runtime provisioning completed.",
          error,
        }),
      });
      throw error;
    }

    if (startedSandbox.sandboxInstanceId !== workflowInput.sandboxInstanceId) {
      throw new Error("Sandbox lifecycle start returned an unexpected sandboxInstanceId.");
    }

    try {
      await step.run({ name: "attach-sandbox-storage" }, async () => {
        logger.info("Attaching sandbox storage before runtime initialization.");
        await attachSandboxStorage(
          {
            db: ctx.db,
            tables: ctx.tables,
            controlPlaneInternalClient: ctx.controlPlaneInternalClient,
            workerConfig: ctx.config.app,
            configuredSandboxProvider: ctx.config.sandbox.provider,
            sandboxAdapter: ctx.sandboxAdapter,
            storageBackend: ctx.config.sandbox.storage?.backend,
          },
          {
            organizationId: workflowInput.organizationId,
            sandboxInstanceId: workflowInput.sandboxInstanceId,
            persistenceMode: workflowInput.persistenceMode,
            runtimeProvider: startedSandbox.runtimeProvider,
            providerSandboxId: startedSandbox.providerSandboxId,
            lifecycle: "start",
          },
        );
      });
      logger.info("Attached sandbox storage before runtime initialization.");
    } catch (error) {
      logger.error({ err: error }, "Sandbox storage attach failed before runtime initialization.");
      await handleFailedStartup({
        sandboxInstanceId: ensuredSandboxInstance.sandboxInstanceId,
        persistenceMode: workflowInput.persistenceMode,
        runtimeProvider: startedSandbox.runtimeProvider,
        providerSandboxId: startedSandbox.providerSandboxId,
        failureCode: StartSandboxFailureCodes.SANDBOX_INIT_FAILED,
        failureMessage: formatPersistedFailureMessage({
          summary: "Sandbox storage attach failed before runtime initialization.",
          error,
        }),
      });
      throw error;
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
            tables: ctx.tables,
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
          persistenceMode: workflowInput.persistenceMode,
          runtimeProvider: startedSandbox.runtimeProvider,
          providerSandboxId: startedSandbox.providerSandboxId,
          failureCode: StartSandboxFailureCodes.PERSIST_PROVISIONING_METADATA_FAILED,
          failureMessage: formatPersistedFailureMessage({
            summary: "Failed to persist sandbox runtime plan and provider sandbox metadata.",
            error,
          }),
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
      await step.run({ name: "initialize-sandbox-runtime" }, async () => {
        logger.info(
          {
            providerSandboxId: startedSandbox.providerSandboxId,
          },
          "Initializing sandbox runtime.",
        );
        await initializeSandboxRuntime(
          {
            config: ctx.config,
            processEnv: ctx.processEnv,
            sandboxRuntimeControl: ctx.sandboxRuntimeControl,
          },
          {
            organizationId: workflowInput.organizationId,
            sandboxInstanceId: startedSandbox.sandboxInstanceId,
            providerSandboxId: startedSandbox.providerSandboxId,
            startupMode: SandboxStartupModes.NEW,
            executionMode: SandboxExecutionModes.SESSION,
            runtimePlan: workflowInput.runtimePlan,
            ...(workflowInput.actingUserId === undefined
              ? {}
              : { actingUserId: workflowInput.actingUserId }),
            ...(workflowInput.gitIdentity === undefined
              ? {}
              : { gitIdentity: workflowInput.gitIdentity }),
          },
        );
      });
      logger.info(
        {
          providerSandboxId: startedSandbox.providerSandboxId,
        },
        "Initialized sandbox runtime.",
      );
    } catch (error) {
      logger.error(
        {
          err: error,
          providerSandboxId: startedSandbox.providerSandboxId,
        },
        "Failed to initialize sandbox runtime.",
      );
      await emitSandboxStartupDiagnostics({
        logger,
        sandboxRuntimeControl: ctx.sandboxRuntimeControl,
        providerSandboxId: startedSandbox.providerSandboxId,
        sandboxInstanceId: startedSandbox.sandboxInstanceId,
        runtimeProvider: startedSandbox.runtimeProvider,
        operation: "init",
        persistenceMode: workflowInput.persistenceMode,
      });
      try {
        await handleFailedStartup({
          sandboxInstanceId: ensuredSandboxInstance.sandboxInstanceId,
          persistenceMode: workflowInput.persistenceMode,
          runtimeProvider: startedSandbox.runtimeProvider,
          providerSandboxId: startedSandbox.providerSandboxId,
          failureCode: StartSandboxFailureCodes.SANDBOX_INIT_FAILED,
          failureMessage: formatPersistedFailureMessage({
            summary: "Failed to initialize sandbox runtime.",
            error,
          }),
        });
      } catch (cleanupError) {
        throw new Error(
          "Failed to initialize sandbox runtime and failed cleanup after startup failure.",
          {
            cause: {
              startupConfigurationError: error,
              cleanupError,
            },
          },
        );
      }

      throw new Error(
        "Failed to initialize sandbox runtime. Sandbox was stopped and sandbox instance was marked as failed.",
        {
          cause: error,
        },
      );
    }

    let didSandboxBecomeReady: boolean;
    try {
      didSandboxBecomeReady = await step.run(
        { name: "wait-for-sandbox-runtime-readiness" },
        async () => {
          logger.info(
            {
              providerSandboxId: startedSandbox.providerSandboxId,
              timeoutMs: ctx.tunnelReadinessPolicy.timeoutMs,
              pollIntervalMs: ctx.tunnelReadinessPolicy.pollIntervalMs,
            },
            "Waiting for sandbox runtime readiness.",
          );
          return waitForSandboxRuntimeReadiness(
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
          didSandboxBecomeReady,
        },
        "Finished waiting for sandbox runtime readiness.",
      );
    } catch (error) {
      logger.error(
        {
          err: error,
          providerSandboxId: startedSandbox.providerSandboxId,
        },
        "Failed while waiting for sandbox runtime readiness.",
      );
      await emitSandboxStartupDiagnostics({
        logger,
        sandboxRuntimeControl: ctx.sandboxRuntimeControl,
        providerSandboxId: startedSandbox.providerSandboxId,
        sandboxInstanceId: startedSandbox.sandboxInstanceId,
        runtimeProvider: startedSandbox.runtimeProvider,
        operation: "init",
        persistenceMode: workflowInput.persistenceMode,
      });
      try {
        await handleFailedStartup({
          sandboxInstanceId: ensuredSandboxInstance.sandboxInstanceId,
          persistenceMode: workflowInput.persistenceMode,
          runtimeProvider: startedSandbox.runtimeProvider,
          providerSandboxId: startedSandbox.providerSandboxId,
          failureCode: StartSandboxFailureCodes.TUNNEL_CONNECT_ACK_WAIT_FAILED,
          failureMessage: formatPersistedFailureMessage({
            summary: "Failed to wait for sandbox runtime readiness.",
            error,
          }),
        });
      } catch (cleanupError) {
        throw new Error(
          "Failed to wait for sandbox runtime readiness and failed cleanup after startup failure.",
          {
            cause: {
              waitForAckError: error,
              cleanupError,
            },
          },
        );
      }

      throw new Error(
        "Failed to wait for sandbox runtime readiness. Sandbox was stopped and sandbox instance was marked as failed.",
        {
          cause: error,
        },
      );
    }

    if (!didSandboxBecomeReady) {
      logger.error(
        {
          providerSandboxId: startedSandbox.providerSandboxId,
          timeoutMs: ctx.tunnelReadinessPolicy.timeoutMs,
        },
        "Sandbox runtime readiness timed out.",
      );
      await emitSandboxStartupDiagnostics({
        logger,
        sandboxRuntimeControl: ctx.sandboxRuntimeControl,
        providerSandboxId: startedSandbox.providerSandboxId,
        sandboxInstanceId: startedSandbox.sandboxInstanceId,
        runtimeProvider: startedSandbox.runtimeProvider,
        operation: "init",
        persistenceMode: workflowInput.persistenceMode,
      });
      try {
        await handleFailedStartup({
          sandboxInstanceId: ensuredSandboxInstance.sandboxInstanceId,
          persistenceMode: workflowInput.persistenceMode,
          runtimeProvider: startedSandbox.runtimeProvider,
          providerSandboxId: startedSandbox.providerSandboxId,
          failureCode: StartSandboxFailureCodes.TUNNEL_CONNECT_ACK_TIMEOUT,
          failureMessage: "Sandbox runtime readiness timed out.",
        });
      } catch (cleanupError) {
        throw new Error(
          "Sandbox runtime readiness timed out and failed cleanup after startup failure.",
          {
            cause: cleanupError,
          },
        );
      }

      throw new Error(
        "Sandbox runtime readiness timed out. Sandbox was stopped and sandbox instance was marked as failed.",
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
            tables: ctx.tables,
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
          persistenceMode: workflowInput.persistenceMode,
          runtimeProvider: startedSandbox.runtimeProvider,
          providerSandboxId: startedSandbox.providerSandboxId,
          failureCode: StartSandboxFailureCodes.STATUS_TRANSITION_TO_RUNNING_FAILED,
          failureMessage: formatPersistedFailureMessage({
            summary: "Failed to transition sandbox instance status from starting to running.",
            error,
          }),
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
