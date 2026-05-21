import {
  SandboxInstancePersistenceModes,
  SandboxInstancePurposes,
  SandboxOperationKinds,
  SandboxUsageEventTypes,
  type SandboxUsageEventType,
} from "@mistle/db/data-plane";
import {
  SandboxProvider,
  isSandboxResourceNotFoundError,
  type SandboxStartStoragePreparation,
} from "@mistle/sandbox";
import type { SandboxdOperationKind } from "@mistle/sandbox-runtime-contract";
import {
  type StartSandboxInstanceWorkflowInput,
  StartSandboxInstanceWorkflowSpec,
  type StartSandboxInstanceWorkflowOutput,
} from "@mistle/workflow-registry/data-plane";
import { rethrowDurableStepErrorForRetry } from "@mistle/workflow-registry/durable-step-retry.js";

import { getWorkflowContext } from "../core/context.js";
import { defineTracedDataPlaneWorkflow } from "../core/tracing.js";
import { attachSandboxStorage } from "../shared/attach-sandbox-storage.js";
import { destroySandbox } from "../shared/destroy-sandbox.js";
import { formatPersistedFailureMessage } from "../shared/format-persisted-failure-message.js";
import { prepareSandboxStorageForStart } from "../shared/prepare-sandbox-storage-for-start.js";
import {
  createWorkerSandboxLifecycleEventRecorder,
  recordWorkerSandboxLifecyclePhase,
} from "../shared/sandbox-operation-events.js";
import { emitSandboxStartupDiagnostics } from "../shared/sandbox-startup-diagnostics.js";
import { createSandboxStorageBackendAdapter } from "../shared/sandbox-storage/create-sandbox-storage-backend-adapter.js";
import {
  createSandboxUsageEventIdempotencyKey,
  recordWorkerSandboxUsageEvent,
} from "../shared/sandbox-usage-events.js";
import { stopSandbox } from "../shared/stop-sandbox.js";
import { markSandboxInstanceStopped } from "../stop-sandbox-instance/mark-sandbox-instance-stopped.js";
import { ensureSandboxInstance } from "./ensure-sandbox-instance.js";
import { initializeSandboxRuntime } from "./initialize-sandbox-runtime.js";
import { markSandboxInstanceFailed } from "./mark-sandbox-instance-failed.js";
import { markSandboxInstanceRunning } from "./mark-sandbox-instance-running.js";
import { persistSandboxInstanceProvisioning } from "./persist-sandbox-instance-provisioning.js";
import { SandboxExecutionModes, SandboxStartupModes } from "./sandbox-startup-input.js";
import { createSandboxRuntimeEnv, prepareSandboxImage, startSandbox } from "./start-sandbox.js";
import { waitForSandboxBootstrapAttachment } from "./wait-for-sandbox-bootstrap-attachment.js";
import { waitForSandboxRuntimeReadiness } from "./wait-for-sandbox-runtime-readiness.js";

const StartSandboxFailureCodes = {
  SANDBOX_STORAGE_PROVISION_FAILED: "sandbox_storage_provision_failed",
  SANDBOX_STORAGE_PREPARE_FAILED: "sandbox_storage_prepare_failed",
  SANDBOX_RUNTIME_RESOLVE_FAILED: "sandbox_runtime_resolve_failed",
  SANDBOX_START_FAILED: "sandbox_start_failed",
  PERSIST_PROVISIONING_METADATA_FAILED: "persist_provisioning_metadata_failed",
  SANDBOX_INIT_FAILED: "sandbox_init_failed",
  SANDBOX_STORAGE_ATTACH_FAILED: "sandbox_storage_attach_failed",
  BOOTSTRAP_ATTACH_TIMEOUT: "bootstrap_attach_timeout",
  BOOTSTRAP_ATTACH_WAIT_FAILED: "bootstrap_attach_wait_failed",
  RUNTIME_READY_TIMEOUT: "runtime_ready_timeout",
  RUNTIME_READY_WAIT_FAILED: "runtime_ready_wait_failed",
  STATUS_TRANSITION_TO_RUNNING_FAILED: "status_transition_to_running_failed",
} as const;

export const StartSandboxInstanceWorkflow = defineTracedDataPlaneWorkflow(
  StartSandboxInstanceWorkflowSpec,
  async ({ input: workflowInput, run, step }): Promise<StartSandboxInstanceWorkflowOutput> => {
    const ctx = await getWorkflowContext();
    const logger = ctx.logger.child({
      workflow: StartSandboxInstanceWorkflowSpec.name,
      workflowRunId: run.id,
      sandboxInstanceId: workflowInput.sandboxInstanceId,
      organizationId: workflowInput.organizationId,
      sandboxProfileId: workflowInput.sandboxProfileId,
      sandboxProfileVersion: workflowInput.sandboxProfileVersion,
      startedBy: workflowInput.startedBy,
      source: workflowInput.source,
      runtimeProvider: workflowInput.sandboxRuntime.provider,
    });
    const runtimeProvider = workflowInput.sandboxRuntime.provider;
    const operationKind = resolveStartSandboxOperationKind(workflowInput.purpose);
    const operationEvents = createWorkerSandboxLifecycleEventRecorder({
      clock: ctx.clock,
      db: ctx.db,
      logger,
      operationId: run.id,
      operationKind,
      sandboxInstanceId: workflowInput.sandboxInstanceId,
    });
    const sandboxRuntimeInput = {
      organizationId: workflowInput.organizationId,
      provider: runtimeProvider,
      ...(workflowInput.sandboxRuntime.connectionId === undefined
        ? {}
        : { connectionId: workflowInput.sandboxRuntime.connectionId }),
      ...(workflowInput.sandboxRuntime.resources === undefined
        ? {}
        : { resources: workflowInput.sandboxRuntime.resources }),
    };

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
      recordUsageFailureEvent?: boolean;
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
            const resolvedRuntime =
              await ctx.sandboxRuntimeProviderResolver.resolve(sandboxRuntimeInput);

            await destroySandbox(
              {
                db: ctx.db,
                tables: ctx.tables,
                controlPlaneInternalClient: ctx.controlPlaneInternalClient,
                config: ctx.config,
                sandboxAdapter: resolvedRuntime.sandboxAdapter,
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
              runtimeProvider,
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

      if (
        input.recordUsageFailureEvent !== false &&
        input.runtimeProvider !== undefined &&
        input.providerSandboxId !== undefined
      ) {
        const providerSandboxId = input.providerSandboxId;
        await step.run({ name: "record-sandbox-failed-usage-event" }, async () => {
          await recordSandboxUsageEvent({
            eventType: SandboxUsageEventTypes.SANDBOX_FAILED,
            providerSandboxId,
            computeGeneration: 1,
            discriminator: input.failureCode,
            payload: {
              failureCode: input.failureCode,
            },
          });
        });
      }
    }

    async function emitStartupDiagnostics(input: {
      providerSandboxId: string;
      sandboxInstanceId: string;
      runtimeProvider: SandboxProvider;
      persistenceMode: (typeof workflowInput)["persistenceMode"];
    }): Promise<void> {
      try {
        const resolvedRuntime =
          await ctx.sandboxRuntimeProviderResolver.resolve(sandboxRuntimeInput);
        await emitSandboxStartupDiagnostics({
          logger,
          sandboxRuntimeControl: resolvedRuntime.sandboxRuntimeControl,
          providerSandboxId: input.providerSandboxId,
          sandboxInstanceId: input.sandboxInstanceId,
          runtimeProvider: input.runtimeProvider,
          operation: "init",
          persistenceMode: input.persistenceMode,
        });
      } catch (error) {
        logger.warn(
          {
            err: error,
            providerSandboxId: input.providerSandboxId,
            sandboxInstanceId: input.sandboxInstanceId,
          },
          "Failed to resolve sandbox runtime for startup diagnostics before cleanup.",
        );
      }
    }

    async function recordSandboxUsageEvent(input: {
      eventType: SandboxUsageEventType;
      providerSandboxId: string;
      computeGeneration: number;
      discriminator?: string;
      payload?: Record<string, unknown>;
    }): Promise<void> {
      await recordWorkerSandboxUsageEvent(
        {
          clock: ctx.clock,
          db: ctx.db,
          tables: ctx.tables,
        },
        {
          idempotencyKey: createSandboxUsageEventIdempotencyKey({
            sandboxInstanceId: workflowInput.sandboxInstanceId,
            computeGeneration: input.computeGeneration,
            eventType: input.eventType,
            operationId: run.id,
            ...(input.discriminator === undefined ? {} : { discriminator: input.discriminator }),
          }),
          organizationId: workflowInput.organizationId,
          sandboxInstanceId: workflowInput.sandboxInstanceId,
          computeGeneration: input.computeGeneration,
          eventType: input.eventType,
          runtimeProvider,
          providerSandboxId: input.providerSandboxId,
          storageProvider: null,
          providerStorageId: null,
          vcpuCount: workflowInput.sandboxRuntime.resources?.vcpuCount ?? null,
          memoryMb: workflowInput.sandboxRuntime.resources?.memoryMb ?? null,
          storageMb: workflowInput.sandboxRuntime.resources?.storageMb ?? null,
          payload: {
            workflowRunId: run.id,
            operationKind,
            purpose: workflowInput.purpose,
            persistenceMode: workflowInput.persistenceMode,
            ...(input.payload ?? {}),
          },
        },
      );
    }

    async function cleanupSetupCheckSandbox(input: {
      providerSandboxId: string;
      runtimeProvider: SandboxProvider;
      sandboxInstanceId: string;
    }): Promise<void> {
      await operationEvents.record({
        attributes: {
          providerSandboxId: input.providerSandboxId,
          runtimeProvider: input.runtimeProvider,
        },
        message: "Setup-check sandbox cleanup started.",
        phase: "stop",
        status: "started",
      });

      try {
        const resolvedRuntime =
          await ctx.sandboxRuntimeProviderResolver.resolve(sandboxRuntimeInput);
        await step.run({ name: "stop-setup-check-sandbox" }, async () => {
          try {
            await stopSandbox(
              {
                db: ctx.db,
                tables: ctx.tables,
                controlPlaneInternalClient: ctx.controlPlaneInternalClient,
                config: ctx.config,
                sandboxAdapter: resolvedRuntime.sandboxAdapter,
              },
              {
                sandboxInstanceId: input.sandboxInstanceId,
                persistenceMode: workflowInput.persistenceMode,
                runtimeProvider: input.runtimeProvider,
                providerSandboxId: input.providerSandboxId,
              },
            );
          } catch (error) {
            if (!isSandboxResourceNotFoundError(error)) {
              throw error;
            }
          }
        });

        const markOutcome = await step.run({ name: "mark-setup-check-sandbox-stopped" }, async () =>
          markSandboxInstanceStopped({
            db: ctx.db,
            tables: ctx.tables,
            sandboxInstanceId: input.sandboxInstanceId,
            stopReason: "system",
          }),
        );
        if (markOutcome === "stopped") {
          await step.run({ name: "record-setup-check-sandbox-stopped-usage-event" }, async () => {
            await recordSandboxUsageEvent({
              eventType: SandboxUsageEventTypes.SANDBOX_STOPPED,
              providerSandboxId: input.providerSandboxId,
              computeGeneration: 1,
              discriminator: "setup-check-cleanup",
              payload: {
                stopReason: "system",
                markOutcome,
              },
            });
          });
        }

        await operationEvents.record({
          attributes: {
            markOutcome,
            providerSandboxId: input.providerSandboxId,
            runtimeProvider: input.runtimeProvider,
          },
          message: "Setup-check sandbox cleanup completed.",
          phase: "stop",
          status: "completed",
        });
      } catch (error) {
        logger.error(
          {
            err: error,
            providerSandboxId: input.providerSandboxId,
            sandboxInstanceId: input.sandboxInstanceId,
          },
          "Failed to clean up setup-check sandbox after successful setup test.",
        );
        await operationEvents.record({
          attributes: {
            error: formatLifecycleEventError(error),
            providerSandboxId: input.providerSandboxId,
            runtimeProvider: input.runtimeProvider,
          },
          message: "Setup-check sandbox cleanup failed.",
          phase: "stop",
          status: "failed",
        });
      }
    }

    const ensuredSandboxInstance = await step.run({ name: "ensure-sandbox-instance" }, async () => {
      logger.info("Ensuring sandbox instance exists before sandbox startup.");
      const persisted = await ensureSandboxInstance(
        {
          db: ctx.db,
          tables: ctx.tables,
          sandboxRuntime: workflowInput.sandboxRuntime,
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

    try {
      const resolvedRuntimeProvider = await step.run(
        { name: "resolve-sandbox-runtime" },
        async () => {
          const resolvedRuntime =
            await ctx.sandboxRuntimeProviderResolver.resolve(sandboxRuntimeInput);
          return resolvedRuntime.provider;
        },
      );
      if (resolvedRuntimeProvider !== runtimeProvider) {
        throw new Error("Resolved sandbox runtime provider did not match requested provider.");
      }
    } catch (error) {
      rethrowDurableStepErrorForRetry(error);
      logger.error({ err: error }, "Sandbox runtime credential resolution failed.");
      await markSandboxInstanceFailedStep({
        sandboxInstanceId: ensuredSandboxInstance.sandboxInstanceId,
        failureCode: StartSandboxFailureCodes.SANDBOX_RUNTIME_RESOLVE_FAILED,
        failureMessage: formatPersistedFailureMessage({
          summary: "Sandbox runtime credential resolution failed before sandbox startup.",
          error,
        }),
      });
      throw error;
    }

    if (workflowInput.persistenceMode === "persistent") {
      try {
        await recordWorkerSandboxLifecyclePhase(
          operationEvents,
          {
            attributes: {
              runtimeProvider,
            },
            completedMessage: "Sandbox persistent storage provisioning completed.",
            failedMessage: "Sandbox persistent storage provisioning failed.",
            phase: "storage_provision",
            startedMessage: "Sandbox persistent storage provisioning started.",
          },
          async () => {
            await step.run({ name: "provision-sandbox-storage" }, async () => {
              logger.info("Provisioning persistent sandbox storage.");
              const storageBackendAdapter = createSandboxStorageBackendAdapter({
                db: ctx.db,
                tables: ctx.tables,
                controlPlaneInternalClient: ctx.controlPlaneInternalClient,
                workerConfig: ctx.config.app,
                runtimeProvider,
                storageBackend: ctx.config.sandbox.storage?.backend,
              });
              await storageBackendAdapter.provision({
                organizationId: workflowInput.organizationId,
                sandboxInstanceId: workflowInput.sandboxInstanceId,
              });
            });
          },
        );
        logger.info("Provisioned persistent sandbox storage.");
      } catch (error) {
        rethrowDurableStepErrorForRetry(error);
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
    let preparedImage = workflowInput.image;
    try {
      preparedImage = await recordWorkerSandboxLifecyclePhase(
        operationEvents,
        {
          attributes: {
            runtimeProvider,
          },
          completedMessage: "Sandbox provider image preparation completed.",
          failedMessage: "Sandbox provider image preparation failed.",
          phase: "provider",
          startedMessage: "Sandbox provider image preparation started.",
        },
        async () => {
          return step.run({ name: "prepare-sandbox-image-for-start" }, async () => {
            logger.info(
              {
                image: workflowInput.image,
                runtimeProvider,
              },
              "Preparing sandbox image with provider.",
            );
            const resolvedRuntime =
              await ctx.sandboxRuntimeProviderResolver.resolveForImagePreparation(
                sandboxRuntimeInput,
              );

            return prepareSandboxImage(
              {
                sandboxAdapter: resolvedRuntime.sandboxAdapter,
              },
              {
                image: workflowInput.image,
                runtimeProvider,
              },
            );
          });
        },
      );
      logger.info(
        {
          image: preparedImage,
          runtimeProvider,
        },
        "Prepared sandbox image with provider.",
      );
    } catch (error) {
      rethrowDurableStepErrorForRetry(error);
      logger.error({ err: error }, "Sandbox provider image preparation failed.");
      await handleFailedStartup({
        sandboxInstanceId: ensuredSandboxInstance.sandboxInstanceId,
        persistenceMode: workflowInput.persistenceMode,
        failureCode: StartSandboxFailureCodes.SANDBOX_START_FAILED,
        failureMessage: formatPersistedFailureMessage({
          summary: "Sandbox provider image preparation failed before sandbox startup.",
          error,
        }),
      });
      throw error;
    }

    let storagePreparation: SandboxStartStoragePreparation | undefined;
    try {
      storagePreparation = await step.run(
        { name: "prepare-sandbox-storage-for-start" },
        async () => {
          logger.info("Preparing sandbox storage before provider start.");
          const resolvedRuntime =
            await ctx.sandboxRuntimeProviderResolver.resolve(sandboxRuntimeInput);

          return prepareSandboxStorageForStart(
            {
              db: ctx.db,
              tables: ctx.tables,
              controlPlaneInternalClient: ctx.controlPlaneInternalClient,
              workerConfig: ctx.config.app,
              configuredSandboxProvider: runtimeProvider,
              sandboxAdapter: resolvedRuntime.sandboxAdapter,
              storageBackend: ctx.config.sandbox.storage?.backend,
            },
            {
              organizationId: workflowInput.organizationId,
              sandboxInstanceId: workflowInput.sandboxInstanceId,
              image: preparedImage,
              persistenceMode: workflowInput.persistenceMode,
              runtimeProvider,
            },
          );
        },
      );
      logger.info("Prepared sandbox storage before provider start.");
    } catch (error) {
      rethrowDurableStepErrorForRetry(error);
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
      startedSandbox = await recordWorkerSandboxLifecyclePhase(
        operationEvents,
        {
          attributes: {
            runtimeProvider,
          },
          completedMessage: "Sandbox provider start completed.",
          failedMessage: "Sandbox provider start failed.",
          phase: "provider",
          startedMessage: "Sandbox provider start started.",
        },
        async () => {
          return step.run({ name: "start-sandbox" }, async () => {
            logger.info(
              {
                image: preparedImage,
                runtimeProvider,
              },
              "Starting sandbox with provider.",
            );
            const resolvedRuntime =
              await ctx.sandboxRuntimeProviderResolver.resolve(sandboxRuntimeInput);

            return startSandbox(
              {
                config: ctx.config,
                processEnv: ctx.processEnv,
                sandboxAdapter: resolvedRuntime.sandboxAdapter,
              },
              {
                sandboxInstanceId: workflowInput.sandboxInstanceId,
                image: preparedImage,
                runtimeProvider,
                ...(workflowInput.sandboxRuntime.resources === undefined
                  ? {}
                  : { resources: workflowInput.sandboxRuntime.resources }),
                storagePreparation,
              },
            );
          });
        },
      );
      logger.info(
        {
          runtimeProvider: startedSandbox.runtimeProvider,
          providerSandboxId: startedSandbox.providerSandboxId,
        },
        "Sandbox provider start completed.",
      );
    } catch (error) {
      rethrowDurableStepErrorForRetry(error);
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
    const waitForPostStartStorageAttach = shouldWaitForPostStartStorageAttach({
      persistenceMode: workflowInput.persistenceMode,
      runtimeProvider,
    });

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
      await step.run({ name: "record-sandbox-allocated-usage-event" }, async () => {
        await recordSandboxUsageEvent({
          eventType: SandboxUsageEventTypes.SANDBOX_ALLOCATED,
          providerSandboxId: startedSandbox.providerSandboxId,
          computeGeneration: 1,
        });
      });
      logger.info(
        {
          providerSandboxId: startedSandbox.providerSandboxId,
        },
        "Persisted sandbox provisioning metadata.",
      );
    } catch (error) {
      rethrowDurableStepErrorForRetry(error);
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
            summary:
              "Failed to persist sandbox runtime plan, provider sandbox metadata, or sandbox allocation usage event.",
            error,
          }),
          recordUsageFailureEvent: false,
        });
      } catch (cleanupError) {
        throw new Error(
          "Failed to persist sandbox provisioning metadata or allocation usage event and failed cleanup after startup failure.",
          {
            cause: {
              persistProvisioningError: error,
              cleanupError,
            },
          },
        );
      }

      throw new Error(
        "Failed to persist sandbox provisioning metadata or allocation usage event. Sandbox was stopped and sandbox instance was marked as failed.",
        {
          cause: error,
        },
      );
    }

    try {
      await step.run({ name: "initialize-sandbox-runtime" }, async () => {
        const resolvedRuntime =
          await ctx.sandboxRuntimeProviderResolver.resolve(sandboxRuntimeInput);

        logger.info(
          {
            providerSandboxId: startedSandbox.providerSandboxId,
            runtimePlan: createRuntimePlanStartupLogFields(workflowInput.runtimePlan),
          },
          "Initializing sandbox runtime.",
        );
        await initializeSandboxRuntime(
          {
            config: ctx.config,
            logger,
            processEnv: ctx.processEnv,
            sandboxAdapter: resolvedRuntime.sandboxAdapter,
            sandboxdArtifactResolver: ctx.sandboxdArtifactResolver,
            sandboxRuntimeControl: resolvedRuntime.sandboxRuntimeControl,
          },
          {
            organizationId: workflowInput.organizationId,
            operationId: run.id,
            operationKind,
            sandboxInstanceId: startedSandbox.sandboxInstanceId,
            providerSandboxId: startedSandbox.providerSandboxId,
            startupMode: SandboxStartupModes.NEW,
            executionMode: SandboxExecutionModes.SESSION,
            waitForCompletion: false,
            waitForStorageAttach: waitForPostStartStorageAttach,
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

      if (!waitForPostStartStorageAttach) {
        await step.run({ name: "wait-for-sandbox-runtime-initialization" }, async () => {
          logger.info("Waiting for sandbox runtime initialization.");
          const resolvedRuntime =
            await ctx.sandboxRuntimeProviderResolver.resolve(sandboxRuntimeInput);
          await resolvedRuntime.sandboxRuntimeControl.waitInit({
            id: startedSandbox.providerSandboxId,
            env: createSandboxRuntimeEnv({
              config: ctx.config,
              sandboxInstanceId: workflowInput.sandboxInstanceId,
              waitForStorageAttach: waitForPostStartStorageAttach,
            }),
          });
        });
      }

      logger.info(
        {
          providerSandboxId: startedSandbox.providerSandboxId,
        },
        "Initialized sandbox runtime.",
      );
    } catch (error) {
      rethrowDurableStepErrorForRetry(error);
      logger.error(
        {
          err: error,
          providerSandboxId: startedSandbox.providerSandboxId,
        },
        "Failed to initialize sandbox runtime.",
      );
      await emitStartupDiagnostics({
        providerSandboxId: startedSandbox.providerSandboxId,
        sandboxInstanceId: startedSandbox.sandboxInstanceId,
        runtimeProvider: startedSandbox.runtimeProvider,
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

    let didBootstrapAttach: boolean;
    try {
      didBootstrapAttach = await step.run(
        { name: "wait-for-sandbox-bootstrap-attachment" },
        async () => {
          logger.info(
            {
              providerSandboxId: startedSandbox.providerSandboxId,
              timeoutMs: ctx.tunnelReadinessPolicy.timeoutMs,
              pollIntervalMs: ctx.tunnelReadinessPolicy.pollIntervalMs,
            },
            "Waiting for sandbox bootstrap attachment.",
          );
          return waitForSandboxBootstrapAttachment(
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
          didBootstrapAttach,
        },
        "Finished waiting for sandbox bootstrap attachment.",
      );
    } catch (error) {
      rethrowDurableStepErrorForRetry(error);
      logger.error(
        {
          err: error,
          providerSandboxId: startedSandbox.providerSandboxId,
        },
        "Failed while waiting for sandbox bootstrap attachment.",
      );
      await emitStartupDiagnostics({
        providerSandboxId: startedSandbox.providerSandboxId,
        sandboxInstanceId: startedSandbox.sandboxInstanceId,
        runtimeProvider: startedSandbox.runtimeProvider,
        persistenceMode: workflowInput.persistenceMode,
      });
      try {
        await handleFailedStartup({
          sandboxInstanceId: ensuredSandboxInstance.sandboxInstanceId,
          persistenceMode: workflowInput.persistenceMode,
          runtimeProvider: startedSandbox.runtimeProvider,
          providerSandboxId: startedSandbox.providerSandboxId,
          failureCode: StartSandboxFailureCodes.BOOTSTRAP_ATTACH_WAIT_FAILED,
          failureMessage: formatPersistedFailureMessage({
            summary: "Failed to wait for sandbox bootstrap attachment.",
            error,
          }),
        });
      } catch (cleanupError) {
        throw new Error(
          "Failed to wait for sandbox bootstrap attachment and failed cleanup after startup failure.",
          {
            cause: {
              waitForBootstrapAttachmentError: error,
              cleanupError,
            },
          },
        );
      }

      throw new Error(
        "Failed to wait for sandbox bootstrap attachment. Sandbox was stopped and sandbox instance was marked as failed.",
        {
          cause: error,
        },
      );
    }

    if (!didBootstrapAttach) {
      logger.error(
        {
          providerSandboxId: startedSandbox.providerSandboxId,
          timeoutMs: ctx.tunnelReadinessPolicy.timeoutMs,
        },
        "Sandbox bootstrap attachment timed out.",
      );
      await emitStartupDiagnostics({
        providerSandboxId: startedSandbox.providerSandboxId,
        sandboxInstanceId: startedSandbox.sandboxInstanceId,
        runtimeProvider: startedSandbox.runtimeProvider,
        persistenceMode: workflowInput.persistenceMode,
      });
      try {
        await handleFailedStartup({
          sandboxInstanceId: ensuredSandboxInstance.sandboxInstanceId,
          persistenceMode: workflowInput.persistenceMode,
          runtimeProvider: startedSandbox.runtimeProvider,
          providerSandboxId: startedSandbox.providerSandboxId,
          failureCode: StartSandboxFailureCodes.BOOTSTRAP_ATTACH_TIMEOUT,
          failureMessage: "Sandbox bootstrap attachment timed out.",
        });
      } catch (cleanupError) {
        throw new Error("Sandbox bootstrap attachment timed out and failed cleanup.", {
          cause: cleanupError,
        });
      }

      throw new Error(
        "Sandbox bootstrap attachment timed out. Sandbox was stopped and sandbox instance was marked as failed.",
      );
    }

    if (waitForPostStartStorageAttach) {
      try {
        await step.run({ name: "attach-sandbox-storage" }, async () => {
          logger.info("Attaching sandbox storage after bootstrap attachment.");
          const resolvedRuntime =
            await ctx.sandboxRuntimeProviderResolver.resolve(sandboxRuntimeInput);

          await attachSandboxStorage(
            {
              db: ctx.db,
              tables: ctx.tables,
              controlPlaneInternalClient: ctx.controlPlaneInternalClient,
              workerConfig: ctx.config.app,
              configuredSandboxProvider: runtimeProvider,
              sandboxAdapter: resolvedRuntime.sandboxAdapter,
              storageBackend: ctx.config.sandbox.storage?.backend,
            },
            {
              organizationId: workflowInput.organizationId,
              sandboxInstanceId: workflowInput.sandboxInstanceId,
              persistenceMode: workflowInput.persistenceMode,
              runtimeProvider: startedSandbox.runtimeProvider,
              providerSandboxId: startedSandbox.providerSandboxId,
              lifecycle: "start",
              operationEventRecorder: operationEvents,
            },
          );
        });
        logger.info("Attached sandbox storage after bootstrap attachment.");
      } catch (error) {
        rethrowDurableStepErrorForRetry(error);
        logger.error({ err: error }, "Sandbox storage attach failed after bootstrap attachment.");
        await emitStartupDiagnostics({
          providerSandboxId: startedSandbox.providerSandboxId,
          sandboxInstanceId: startedSandbox.sandboxInstanceId,
          runtimeProvider: startedSandbox.runtimeProvider,
          persistenceMode: workflowInput.persistenceMode,
        });
        await handleFailedStartup({
          sandboxInstanceId: ensuredSandboxInstance.sandboxInstanceId,
          persistenceMode: workflowInput.persistenceMode,
          runtimeProvider: startedSandbox.runtimeProvider,
          providerSandboxId: startedSandbox.providerSandboxId,
          failureCode: StartSandboxFailureCodes.SANDBOX_STORAGE_ATTACH_FAILED,
          failureMessage: formatPersistedFailureMessage({
            summary: "Sandbox storage attach failed after bootstrap attachment.",
            error,
          }),
        });
        throw error;
      }
    }

    if (waitForPostStartStorageAttach) {
      try {
        await step.run({ name: "wait-for-sandbox-runtime-initialization" }, async () => {
          logger.info("Waiting for sandbox runtime initialization after storage attach.");
          const resolvedRuntime =
            await ctx.sandboxRuntimeProviderResolver.resolve(sandboxRuntimeInput);
          await resolvedRuntime.sandboxRuntimeControl.waitInit({
            id: startedSandbox.providerSandboxId,
            env: createSandboxRuntimeEnv({
              config: ctx.config,
              sandboxInstanceId: workflowInput.sandboxInstanceId,
              waitForStorageAttach: waitForPostStartStorageAttach,
            }),
          });
        });
        logger.info("Sandbox runtime initialization completed after storage attach.");
      } catch (error) {
        rethrowDurableStepErrorForRetry(error);
        logger.error({ err: error }, "Sandbox runtime initialization failed after storage attach.");
        await emitStartupDiagnostics({
          providerSandboxId: startedSandbox.providerSandboxId,
          sandboxInstanceId: startedSandbox.sandboxInstanceId,
          runtimeProvider: startedSandbox.runtimeProvider,
          persistenceMode: workflowInput.persistenceMode,
        });
        await handleFailedStartup({
          sandboxInstanceId: ensuredSandboxInstance.sandboxInstanceId,
          persistenceMode: workflowInput.persistenceMode,
          runtimeProvider: startedSandbox.runtimeProvider,
          providerSandboxId: startedSandbox.providerSandboxId,
          failureCode: StartSandboxFailureCodes.SANDBOX_INIT_FAILED,
          failureMessage: formatPersistedFailureMessage({
            summary: "Sandbox runtime initialization failed after storage attach.",
            error,
          }),
        });
        throw error;
      }
    }

    if (workflowInput.purpose === SandboxInstancePurposes.SETUP_CHECK) {
      await operationEvents.record({
        attributes: {
          providerSandboxId: startedSandbox.providerSandboxId,
          runtimeProvider: startedSandbox.runtimeProvider,
        },
        message: "Setup-check sandbox runtime adapters initialized.",
        phase: "runtime_adapters",
        status: "completed",
      });
    }

    let didSandboxBecomeReady: boolean;
    try {
      const readinessAttributes = {
        providerSandboxId: startedSandbox.providerSandboxId,
        runtimeProvider: startedSandbox.runtimeProvider,
      };
      await operationEvents.record({
        attributes: readinessAttributes,
        message: "Sandbox runtime readiness wait started.",
        phase: "ready",
        status: "started",
      });
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
      if (didSandboxBecomeReady) {
        await operationEvents.record({
          attributes: readinessAttributes,
          message: "Sandbox runtime readiness wait completed.",
          phase: "ready",
          status: "completed",
        });
      }
      logger.info(
        {
          providerSandboxId: startedSandbox.providerSandboxId,
          didSandboxBecomeReady,
        },
        "Finished waiting for sandbox runtime readiness.",
      );
    } catch (error) {
      rethrowDurableStepErrorForRetry(error);
      await operationEvents.record({
        attributes: {
          providerSandboxId: startedSandbox.providerSandboxId,
          runtimeProvider: startedSandbox.runtimeProvider,
        },
        message: "Sandbox runtime readiness wait failed.",
        phase: "ready",
        status: "failed",
      });
      logger.error(
        {
          err: error,
          providerSandboxId: startedSandbox.providerSandboxId,
        },
        "Failed while waiting for sandbox runtime readiness.",
      );
      await emitStartupDiagnostics({
        providerSandboxId: startedSandbox.providerSandboxId,
        sandboxInstanceId: startedSandbox.sandboxInstanceId,
        runtimeProvider: startedSandbox.runtimeProvider,
        persistenceMode: workflowInput.persistenceMode,
      });
      try {
        await handleFailedStartup({
          sandboxInstanceId: ensuredSandboxInstance.sandboxInstanceId,
          persistenceMode: workflowInput.persistenceMode,
          runtimeProvider: startedSandbox.runtimeProvider,
          providerSandboxId: startedSandbox.providerSandboxId,
          failureCode: StartSandboxFailureCodes.RUNTIME_READY_WAIT_FAILED,
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
              waitForRuntimeReadinessError: error,
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
      await operationEvents.record({
        attributes: {
          providerSandboxId: startedSandbox.providerSandboxId,
          runtimeProvider: startedSandbox.runtimeProvider,
          timeoutMs: ctx.tunnelReadinessPolicy.timeoutMs,
        },
        message: "Sandbox runtime readiness timed out.",
        phase: "ready",
        status: "failed",
      });
      logger.error(
        {
          providerSandboxId: startedSandbox.providerSandboxId,
          timeoutMs: ctx.tunnelReadinessPolicy.timeoutMs,
        },
        "Sandbox runtime readiness timed out.",
      );
      await emitStartupDiagnostics({
        providerSandboxId: startedSandbox.providerSandboxId,
        sandboxInstanceId: startedSandbox.sandboxInstanceId,
        runtimeProvider: startedSandbox.runtimeProvider,
        persistenceMode: workflowInput.persistenceMode,
      });
      try {
        await handleFailedStartup({
          sandboxInstanceId: ensuredSandboxInstance.sandboxInstanceId,
          persistenceMode: workflowInput.persistenceMode,
          runtimeProvider: startedSandbox.runtimeProvider,
          providerSandboxId: startedSandbox.providerSandboxId,
          failureCode: StartSandboxFailureCodes.RUNTIME_READY_TIMEOUT,
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
      await recordWorkerSandboxLifecyclePhase(
        operationEvents,
        {
          attributes: {
            providerSandboxId: startedSandbox.providerSandboxId,
            runtimeProvider: startedSandbox.runtimeProvider,
          },
          completedMessage: "Sandbox instance running status transition completed.",
          failedMessage: "Sandbox instance running status transition failed.",
          phase: "running",
          startedMessage: "Sandbox instance running status transition started.",
        },
        async () => {
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
        },
      );
      logger.info(
        {
          providerSandboxId: startedSandbox.providerSandboxId,
        },
        "Sandbox start workflow completed successfully.",
      );
    } catch (error) {
      rethrowDurableStepErrorForRetry(error);
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

    await step.run({ name: "record-sandbox-ready-usage-event" }, async () => {
      await recordSandboxUsageEvent({
        eventType: SandboxUsageEventTypes.SANDBOX_READY,
        providerSandboxId: startedSandbox.providerSandboxId,
        computeGeneration: 1,
      });
    });

    if (workflowInput.purpose === SandboxInstancePurposes.SETUP_CHECK) {
      await cleanupSetupCheckSandbox({
        providerSandboxId: startedSandbox.providerSandboxId,
        runtimeProvider: startedSandbox.runtimeProvider,
        sandboxInstanceId: ensuredSandboxInstance.sandboxInstanceId,
      });
    }

    return {
      sandboxInstanceId: ensuredSandboxInstance.sandboxInstanceId,
      providerSandboxId: startedSandbox.providerSandboxId,
    };
  },
);

function createRuntimePlanStartupLogFields(
  runtimePlan: StartSandboxInstanceWorkflowInput["runtimePlan"],
): {
  workspaceSourceCount: number;
  workspaceSources: {
    sourceKind: string;
    resourceKind: string;
    path: string;
    originHost: string;
    originPath: string;
  }[];
  egressRouteCount: number;
  egressRoutes: {
    egressRuleId: string;
    bindingId: string;
    familyId: string;
    variantId: string;
    hosts: readonly string[];
    pathPrefixes?: readonly string[];
    upstreamHost: string;
    upstreamPath: string;
    credentialResolverKind: string;
    credentialConnectionId?: string;
    credentialMistleMcpApiKeyId?: string;
    credentialMistleMcpSandboxProfileId?: string;
    credentialMistleMcpSandboxProfileVersion?: number;
    credentialProviderFamily?: string;
  }[];
} {
  return {
    workspaceSourceCount: runtimePlan.workspaceSources.length,
    workspaceSources: runtimePlan.workspaceSources.map((workspaceSource) => {
      const originUrl = new URL(workspaceSource.originUrl);
      return {
        sourceKind: workspaceSource.sourceKind,
        resourceKind: workspaceSource.resourceKind,
        path: workspaceSource.path,
        originHost: originUrl.host,
        originPath: originUrl.pathname,
      };
    }),
    egressRouteCount: runtimePlan.egressRoutes.length,
    egressRoutes: runtimePlan.egressRoutes.map((egressRoute) => {
      const upstreamUrl = new URL(egressRoute.upstream.baseUrl);
      return {
        egressRuleId: egressRoute.egressRuleId,
        bindingId: egressRoute.bindingId,
        familyId: egressRoute.familyId,
        variantId: egressRoute.variantId,
        hosts: egressRoute.match.hosts,
        ...(egressRoute.match.pathPrefixes === undefined
          ? {}
          : { pathPrefixes: egressRoute.match.pathPrefixes }),
        upstreamHost: upstreamUrl.host,
        upstreamPath: upstreamUrl.pathname,
        credentialResolverKind: egressRoute.credentialResolver.kind,
        ...(egressRoute.credentialResolver.kind === "integration_connection"
          ? { credentialConnectionId: egressRoute.credentialResolver.connectionId }
          : egressRoute.credentialResolver.kind === "mistle_mcp_token"
            ? { credentialMistleMcpApiKeyId: egressRoute.credentialResolver.apiKeyId }
            : egressRoute.credentialResolver.kind === "mistle_mcp_setup_assistant_token"
              ? {
                  credentialMistleMcpSandboxProfileId:
                    egressRoute.credentialResolver.sandboxProfileId,
                  credentialMistleMcpSandboxProfileVersion:
                    egressRoute.credentialResolver.sandboxProfileVersion,
                }
              : { credentialProviderFamily: egressRoute.credentialResolver.providerFamily }),
      };
    }),
  };
}

function shouldWaitForPostStartStorageAttach(input: {
  persistenceMode: StartSandboxInstanceWorkflowInput["persistenceMode"];
  runtimeProvider: SandboxProvider;
}): boolean {
  return (
    input.persistenceMode === SandboxInstancePersistenceModes.PERSISTENT &&
    input.runtimeProvider !== SandboxProvider.DOCKER
  );
}

function resolveStartSandboxOperationKind(
  purpose: StartSandboxInstanceWorkflowInput["purpose"],
): SandboxdOperationKind {
  if (
    purpose === SandboxInstancePurposes.SESSION ||
    purpose === SandboxInstancePurposes.SETUP_ASSISTANT
  ) {
    return SandboxOperationKinds.START;
  }

  if (purpose === SandboxInstancePurposes.SETUP_CHECK) {
    return SandboxOperationKinds.SETUP_CHECK;
  }

  if (purpose === SandboxInstancePurposes.SNAPSHOT) {
    return SandboxOperationKinds.SNAPSHOT;
  }

  return assertUnsupportedSandboxInstancePurpose(purpose);
}

function assertUnsupportedSandboxInstancePurpose(_purpose: never): never {
  throw new Error("Unsupported sandbox instance purpose.");
}

function formatLifecycleEventError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export const startSandboxWorkflowTestInternals = {
  resolveStartSandboxOperationKind,
  shouldWaitForPostStartStorageAttach,
};
