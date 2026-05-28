import { SandboxUsageEventTypes, type SandboxUsageEventType } from "@mistle/db/data-plane";
import { isSandboxResourceNotFoundError, type SandboxProvider } from "@mistle/sandbox";
import { SandboxLifecycleEvents } from "@mistle/sandbox-lifecycle";
import {
  type ResumeSandboxInstanceWorkflowOutput,
  ResumeSandboxInstanceWorkflowSpec,
  SandboxStartImageKinds,
  type StartSandboxInstanceWorkflowImageInput,
} from "@mistle/workflow-registry/data-plane";
import { rethrowDurableStepErrorForRetry } from "@mistle/workflow-registry/durable-step-retry.js";

import { getWorkflowContext } from "../core/context.js";
import { createResolveSandboxRuntimeInput } from "../core/sandbox-runtime-resolver.js";
import { defineTracedDataPlaneWorkflow } from "../core/tracing.js";
import { applySandboxLifecycleEvent } from "../shared/apply-sandbox-lifecycle-event.js";
import { attachSandboxStorage } from "../shared/attach-sandbox-storage.js";
import { destroySandbox } from "../shared/destroy-sandbox.js";
import { formatPersistedFailureMessage } from "../shared/format-persisted-failure-message.js";
import { markSandboxInstanceStarting } from "../shared/mark-sandbox-instance-starting.js";
import { prepareSandboxStorageForStart } from "../shared/prepare-sandbox-storage-for-start.js";
import {
  createWorkerSandboxLifecycleEventRecorder,
  recordWorkerSandboxLifecyclePhase,
} from "../shared/sandbox-operation-events.js";
import { emitSandboxStartupDiagnostics } from "../shared/sandbox-startup-diagnostics.js";
import {
  createSandboxUsageEventIdempotencyKey,
  recordWorkerSandboxUsageEvent,
} from "../shared/sandbox-usage-events.js";
import { stopSandbox } from "../shared/stop-sandbox.js";
import { initializeSandboxRuntime } from "../start-sandbox-instance/initialize-sandbox-runtime.js";
import { markSandboxInstanceFailed } from "../start-sandbox-instance/mark-sandbox-instance-failed.js";
import { markSandboxInstanceRunning } from "../start-sandbox-instance/mark-sandbox-instance-running.js";
import { resumeSandboxRuntime } from "../start-sandbox-instance/resume-sandbox-runtime.js";
import { prepareSandboxImage, startSandbox } from "../start-sandbox-instance/start-sandbox.js";
import { waitForSandboxRuntimeReadiness } from "../start-sandbox-instance/wait-for-sandbox-runtime-readiness.js";
import { persistSandboxInstanceComputeReplacement } from "./persist-sandbox-instance-compute-replacement.js";
import {
  resolveResumableSandboxInstanceState,
  type ResumableSandboxInstanceState,
} from "./resolve-resumable-sandbox-instance-state.js";
import { resumeSandbox } from "./resume-sandbox.js";
import { revertSandboxInstanceComputeReplacement } from "./revert-sandbox-instance-compute-replacement.js";

const ResumeSandboxFailureCodes = {
  RESUME_SANDBOX_FAILED: "resume_sandbox_failed",
  SANDBOX_INIT_FAILED: "sandbox_init_failed",
  TUNNEL_CONNECT_ACK_TIMEOUT: "tunnel_connect_ack_timeout",
  TUNNEL_CONNECT_ACK_WAIT_FAILED: "tunnel_connect_ack_wait_failed",
  STATUS_TRANSITION_TO_RUNNING_FAILED: "status_transition_to_running_failed",
} as const;

function createResumeWorkflowLogFields(input: {
  sandboxInstanceId: string;
  organizationId?: string | undefined;
  runtimeProvider?: SandboxProvider | undefined;
  providerSandboxId?: string | null | undefined;
  persistenceMode?: string | undefined;
  computeGeneration?: number | undefined;
}) {
  return {
    eventName: "sandbox_instance.resume_phase",
    sandboxInstanceId: input.sandboxInstanceId,
    ...(input.organizationId === undefined ? {} : { organizationId: input.organizationId }),
    ...(input.runtimeProvider === undefined ? {} : { runtimeProvider: input.runtimeProvider }),
    ...(input.providerSandboxId === undefined || input.providerSandboxId === null
      ? {}
      : { providerSandboxId: input.providerSandboxId }),
    ...(input.persistenceMode === undefined ? {} : { persistenceMode: input.persistenceMode }),
    ...(input.computeGeneration === undefined
      ? {}
      : { computeGeneration: input.computeGeneration }),
  };
}

export const ResumeSandboxInstanceWorkflow = defineTracedDataPlaneWorkflow(
  ResumeSandboxInstanceWorkflowSpec,
  async ({ input, run, step }): Promise<ResumeSandboxInstanceWorkflowOutput> => {
    const ctx = await getWorkflowContext();
    const logger = ctx.logger.child({
      workflow: ResumeSandboxInstanceWorkflowSpec.name,
      workflowRunId: run.id,
      sandboxInstanceId: input.sandboxInstanceId,
    });
    const operationEvents = createWorkerSandboxLifecycleEventRecorder({
      clock: ctx.clock,
      db: ctx.db,
      logger,
      operationId: run.id,
      operationKind: "resume",
      sandboxInstanceId: input.sandboxInstanceId,
    });

    function rethrowResumeDurableStepErrorForRetry(error: unknown): void {
      rethrowDurableStepErrorForRetry(error, {
        attributes: {
          sandboxInstanceId: input.sandboxInstanceId,
        },
        eventName: "sandbox_instance.resume_step_retry",
        logger,
        message: "Retrying sandbox resume workflow after durable step failure.",
      });
    }

    async function recordResumeSandboxUsageEvent(input: {
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
            sandboxInstanceId: resumableSandboxState.sandboxInstanceId,
            computeGeneration: input.computeGeneration,
            eventType: input.eventType,
            operationId: run.id,
            ...(input.discriminator === undefined ? {} : { discriminator: input.discriminator }),
          }),
          organizationId: resumableSandboxState.organizationId,
          sandboxInstanceId: resumableSandboxState.sandboxInstanceId,
          computeGeneration: input.computeGeneration,
          eventType: input.eventType,
          runtimeProvider: resumableSandboxState.runtimeProvider,
          providerSandboxId: input.providerSandboxId,
          storageProvider: null,
          providerStorageId: null,
          vcpuCount: resumableSandboxState.sandboxVcpuCount,
          memoryMb: resumableSandboxState.sandboxMemoryMb,
          storageMb: resumableSandboxState.sandboxStorageMb,
          payload: {
            workflowRunId: run.id,
            operationKind: "resume",
            persistenceMode: resumableSandboxState.persistenceMode,
            ...(input.payload ?? {}),
          },
        },
      );
    }

    logger.info(
      createResumeWorkflowLogFields({
        sandboxInstanceId: input.sandboxInstanceId,
      }),
      "Starting sandbox instance resume workflow.",
    );

    const resumableSandboxInstance = await step.run(
      { name: "resolve-resumable-sandbox-instance-state" },
      async () => {
        return resolveResumableSandboxInstanceState({
          db: ctx.db,
          tables: ctx.tables,
          sandboxInstanceId: input.sandboxInstanceId,
        });
      },
    );

    if (resumableSandboxInstance === null) {
      logger.info(
        createResumeWorkflowLogFields({
          sandboxInstanceId: input.sandboxInstanceId,
        }),
        "Skipping sandbox instance resume workflow because sandbox is already active.",
      );
      return {
        sandboxInstanceId: input.sandboxInstanceId,
      };
    }

    const resumableSandboxState = resumableSandboxInstance;
    logger.info(
      createResumeWorkflowLogFields({
        sandboxInstanceId: input.sandboxInstanceId,
        organizationId: resumableSandboxState.organizationId,
        runtimeProvider: resumableSandboxState.runtimeProvider,
        providerSandboxId: resumableSandboxState.providerSandboxId,
        persistenceMode: resumableSandboxState.persistenceMode,
        computeGeneration: resumableSandboxState.computeGeneration,
      }),
      "Resolved resumable sandbox instance state.",
    );

    const resolvedRuntime = await ctx.sandboxRuntimeProviderResolver.resolve(
      createResolveSandboxRuntimeInput(resumableSandboxState),
    );

    logger.info(
      createResumeWorkflowLogFields({
        sandboxInstanceId: input.sandboxInstanceId,
        organizationId: resumableSandboxState.organizationId,
        runtimeProvider: resumableSandboxState.runtimeProvider,
        providerSandboxId: resumableSandboxState.providerSandboxId,
        persistenceMode: resumableSandboxState.persistenceMode,
        computeGeneration: resumableSandboxState.computeGeneration,
      }),
      "Marking sandbox instance as starting before resume.",
    );
    await step.run({ name: "mark-sandbox-instance-starting" }, async () => {
      await markSandboxInstanceStarting({
        db: ctx.db,
        logger,
        tables: ctx.tables,
        sandboxInstanceId: input.sandboxInstanceId,
      });
    });

    if (resumableSandboxState.providerSandboxId !== null) {
      const existingProviderSandboxId = resumableSandboxState.providerSandboxId;
      let existingResumeFailureHandled = false;
      try {
        logger.info(
          createResumeWorkflowLogFields({
            sandboxInstanceId: input.sandboxInstanceId,
            organizationId: resumableSandboxState.organizationId,
            runtimeProvider: resumableSandboxState.runtimeProvider,
            providerSandboxId: existingProviderSandboxId,
            persistenceMode: resumableSandboxState.persistenceMode,
            computeGeneration: resumableSandboxState.computeGeneration,
          }),
          "Resuming existing sandbox provider compute.",
        );
        const providerResumeAttributes = {
          providerSandboxId: existingProviderSandboxId,
          runtimeProvider: resumableSandboxState.runtimeProvider,
          timelineKey: "sandbox",
          timelineLabel: "Resuming sandbox",
        };
        await operationEvents.record({
          attributes: providerResumeAttributes,
          message: "Sandbox provider resume started.",
          phase: "provider",
          status: "started",
        });
        const resumedRuntime = await step.run(
          { name: "resume-existing-sandbox-compute" },
          async () => {
            try {
              return await resumeSandbox(
                {
                  config: ctx.config,
                  processEnv: ctx.processEnv,
                  sandboxAdapter: resolvedRuntime.sandboxAdapter,
                },
                {
                  sandboxInstanceId: resumableSandboxState.sandboxInstanceId,
                  runtimeProvider: resumableSandboxState.runtimeProvider,
                  providerSandboxId: existingProviderSandboxId,
                },
              );
            } catch (error) {
              if (
                resumableSandboxState.persistenceMode === "persistent" &&
                isRecoverableMissingSandboxError(error)
              ) {
                return null;
              }

              await operationEvents.record({
                attributes: {
                  ...providerResumeAttributes,
                  error: error instanceof Error ? error.message : String(error),
                },
                message: "Sandbox provider resume failed.",
                phase: "provider",
                status: "failed",
              });
              throw error;
            }
          },
        );
        if (resumedRuntime === null) {
          await operationEvents.record({
            attributes: providerResumeAttributes,
            message:
              "Existing sandbox provider compute was missing; switching to replacement resume.",
            phase: "provider",
            status: "warning",
          });
        } else {
          await operationEvents.record({
            attributes: providerResumeAttributes,
            message: "Sandbox provider resume completed.",
            phase: "provider",
            status: "completed",
          });
        }

        logger.info(
          createResumeWorkflowLogFields({
            sandboxInstanceId: input.sandboxInstanceId,
            organizationId: resumableSandboxState.organizationId,
            runtimeProvider: resumableSandboxState.runtimeProvider,
            providerSandboxId: existingProviderSandboxId,
            persistenceMode: resumableSandboxState.persistenceMode,
            computeGeneration: resumableSandboxState.computeGeneration,
          }),
          resumedRuntime === null
            ? "Existing sandbox provider compute was missing; switching to replacement resume."
            : "Resumed existing sandbox provider compute.",
        );

        if (resumedRuntime !== null) {
          await step.run({ name: "mark-resumed-sandbox-instance-started" }, async () => {
            await applySandboxLifecycleEvent(
              {
                db: ctx.db,
                logger,
                tables: ctx.tables,
              },
              {
                sandboxInstanceId: input.sandboxInstanceId,
                event: SandboxLifecycleEvents.PROVIDER_START_ACCEPTED,
              },
            );
          });

          try {
            await step.run({ name: "record-sandbox-resumed-usage-event" }, async () => {
              await recordResumeSandboxUsageEvent({
                eventType: SandboxUsageEventTypes.SANDBOX_RESUMED,
                providerSandboxId: resumedRuntime.providerSandboxId,
                computeGeneration: resumableSandboxState.computeGeneration,
              });
            });
          } catch (error) {
            existingResumeFailureHandled = true;
            throw error;
          }

          try {
            await step.run({ name: "mark-resumed-sandbox-instance-initializing" }, async () => {
              await applySandboxLifecycleEvent(
                {
                  db: ctx.db,
                  logger,
                  tables: ctx.tables,
                },
                {
                  sandboxInstanceId: input.sandboxInstanceId,
                  event: SandboxLifecycleEvents.PROVIDER_RUNTIME_INITIALIZATION_STARTED,
                },
              );
            });

            logger.info(
              createResumeWorkflowLogFields({
                sandboxInstanceId: input.sandboxInstanceId,
                organizationId: resumableSandboxState.organizationId,
                runtimeProvider: resumedRuntime.runtimeProvider,
                providerSandboxId: resumedRuntime.providerSandboxId,
                persistenceMode: resumableSandboxState.persistenceMode,
                computeGeneration: resumableSandboxState.computeGeneration,
              }),
              "Attaching sandbox storage before resumed runtime initialization.",
            );
            await step.run({ name: "attach-resumed-sandbox-storage" }, async () => {
              await attachSandboxStorage(
                {
                  db: ctx.db,
                  tables: ctx.tables,
                  controlPlaneInternalClient: ctx.controlPlaneInternalClient,
                  workerConfig: ctx.config.app,
                  configuredSandboxProvider: resumableSandboxState.runtimeProvider,
                  sandboxAdapter: resolvedRuntime.sandboxAdapter,
                  storageBackend: ctx.config.sandbox.storage?.backend,
                },
                {
                  organizationId: resumableSandboxState.organizationId,
                  sandboxInstanceId: input.sandboxInstanceId,
                  persistenceMode: resumableSandboxState.persistenceMode,
                  runtimeProvider: resumedRuntime.runtimeProvider,
                  providerSandboxId: resumedRuntime.providerSandboxId,
                  lifecycle: "resume",
                  operationEventRecorder: operationEvents,
                },
              );
            });
            logger.info(
              createResumeWorkflowLogFields({
                sandboxInstanceId: input.sandboxInstanceId,
                organizationId: resumableSandboxState.organizationId,
                runtimeProvider: resumedRuntime.runtimeProvider,
                providerSandboxId: resumedRuntime.providerSandboxId,
                persistenceMode: resumableSandboxState.persistenceMode,
                computeGeneration: resumableSandboxState.computeGeneration,
              }),
              "Attached sandbox storage before resumed runtime initialization.",
            );
          } catch (error) {
            rethrowResumeDurableStepErrorForRetry(error);
            existingResumeFailureHandled = true;
            const failureMessage = formatPersistedFailureMessage({
              summary: "Failed to attach sandbox storage before resume runtime initialization.",
              error,
            });

            let stopSandboxError: unknown;
            try {
              await step.run({ name: "stop-sandbox-after-resume-failure" }, async () => {
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
                    persistenceMode: resumableSandboxState.persistenceMode,
                    runtimeProvider: resumedRuntime.runtimeProvider,
                    providerSandboxId: resumedRuntime.providerSandboxId,
                  },
                );
              });
            } catch (stopError) {
              if (!isRecoverableMissingSandboxError(stopError)) {
                logger.error({ err: stopError }, "Failed to stop sandbox after resume failure.");
                stopSandboxError = stopError;
              }
            }

            let markFailedError: unknown;
            logger.warn(
              {
                failureCode: ResumeSandboxFailureCodes.SANDBOX_INIT_FAILED,
                failureMessage,
              },
              "Marking sandbox instance as failed during resume workflow.",
            );
            try {
              await step.run(
                { name: "mark-sandbox-instance-failed-after-resume-failure" },
                async () => {
                  await markSandboxInstanceFailed(
                    {
                      db: ctx.db,
                      tables: ctx.tables,
                    },
                    {
                      sandboxInstanceId: input.sandboxInstanceId,
                      failureCode: ResumeSandboxFailureCodes.SANDBOX_INIT_FAILED,
                      failureMessage,
                    },
                  );
                },
              );
            } catch (markError) {
              logger.error(
                { err: markError },
                "Failed to mark sandbox instance as failed after resume failure.",
              );
              markFailedError = markError;
            }

            throwResumeFailureHandlingErrors({
              stopSandboxError,
              markFailedError,
            });
            throw error;
          }

          try {
            logger.info(
              createResumeWorkflowLogFields({
                sandboxInstanceId: input.sandboxInstanceId,
                organizationId: resumableSandboxState.organizationId,
                runtimeProvider: resumedRuntime.runtimeProvider,
                providerSandboxId: resumedRuntime.providerSandboxId,
                persistenceMode: resumableSandboxState.persistenceMode,
                computeGeneration: resumableSandboxState.computeGeneration,
              }),
              "Initializing resumed sandbox runtime.",
            );
            await step.run({ name: "initialize-resumed-sandbox-runtime" }, async () => {
              await resumeSandboxRuntime(
                {
                  config: ctx.config,
                  logger,
                  processEnv: ctx.processEnv,
                  sandboxAdapter: resolvedRuntime.sandboxAdapter,
                  sandboxdArtifactResolver: ctx.sandboxdArtifactResolver,
                  sandboxRuntimeControl: resolvedRuntime.sandboxRuntimeControl,
                },
                {
                  organizationId: resumableSandboxState.organizationId,
                  operationId: run.id,
                  operationKind: "resume",
                  sandboxInstanceId: resumedRuntime.sandboxInstanceId,
                  providerSandboxId: resumedRuntime.providerSandboxId,
                  runtimeProvider: resumedRuntime.runtimeProvider,
                  runtimePlan: resumableSandboxState.runtimePlan,
                  ...(input.actingUserId === undefined ? {} : { actingUserId: input.actingUserId }),
                  ...(input.gitIdentity === undefined ? {} : { gitIdentity: input.gitIdentity }),
                },
              );
            });
            logger.info(
              createResumeWorkflowLogFields({
                sandboxInstanceId: input.sandboxInstanceId,
                organizationId: resumableSandboxState.organizationId,
                runtimeProvider: resumedRuntime.runtimeProvider,
                providerSandboxId: resumedRuntime.providerSandboxId,
                persistenceMode: resumableSandboxState.persistenceMode,
                computeGeneration: resumableSandboxState.computeGeneration,
              }),
              "Initialized resumed sandbox runtime.",
            );
          } catch (error) {
            rethrowResumeDurableStepErrorForRetry(error);
            existingResumeFailureHandled = true;
            const failureMessage = formatPersistedFailureMessage({
              summary: "Failed to initialize resumed sandbox runtime.",
              error,
            });
            await emitSandboxStartupDiagnostics({
              logger,
              sandboxRuntimeControl: resolvedRuntime.sandboxRuntimeControl,
              providerSandboxId: resumedRuntime.providerSandboxId,
              sandboxInstanceId: resumedRuntime.sandboxInstanceId,
              runtimeProvider: resumedRuntime.runtimeProvider,
              operation: "resume",
              persistenceMode: resumableSandboxState.persistenceMode,
            });

            let stopSandboxError: unknown;
            try {
              await step.run({ name: "stop-sandbox-after-resume-failure" }, async () => {
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
                    persistenceMode: resumableSandboxState.persistenceMode,
                    runtimeProvider: resumedRuntime.runtimeProvider,
                    providerSandboxId: resumedRuntime.providerSandboxId,
                  },
                );
              });
            } catch (stopError) {
              if (!isRecoverableMissingSandboxError(stopError)) {
                logger.error({ err: stopError }, "Failed to stop sandbox after resume failure.");
                stopSandboxError = stopError;
              }
            }

            let markFailedError: unknown;
            logger.warn(
              {
                failureCode: ResumeSandboxFailureCodes.SANDBOX_INIT_FAILED,
                failureMessage,
              },
              "Marking sandbox instance as failed during resume workflow.",
            );
            try {
              await step.run(
                { name: "mark-sandbox-instance-failed-after-resume-failure" },
                async () => {
                  await markSandboxInstanceFailed(
                    {
                      db: ctx.db,
                      tables: ctx.tables,
                    },
                    {
                      sandboxInstanceId: input.sandboxInstanceId,
                      failureCode: ResumeSandboxFailureCodes.SANDBOX_INIT_FAILED,
                      failureMessage,
                    },
                  );
                },
              );
            } catch (markError) {
              logger.error(
                { err: markError },
                "Failed to mark sandbox instance as failed after resume failure.",
              );
              markFailedError = markError;
            }

            throwResumeFailureHandlingErrors({
              stopSandboxError,
              markFailedError,
            });
            throw error;
          }

          let resumedSandboxRuntimeReady: boolean;
          try {
            logger.info(
              createResumeWorkflowLogFields({
                sandboxInstanceId: input.sandboxInstanceId,
                organizationId: resumableSandboxState.organizationId,
                runtimeProvider: resumedRuntime.runtimeProvider,
                providerSandboxId: resumedRuntime.providerSandboxId,
                persistenceMode: resumableSandboxState.persistenceMode,
                computeGeneration: resumableSandboxState.computeGeneration,
              }),
              "Waiting for resumed sandbox runtime readiness.",
            );
            const readinessAttributes = {
              providerSandboxId: resumedRuntime.providerSandboxId,
              runtimeProvider: resumedRuntime.runtimeProvider,
            };
            await operationEvents.record({
              attributes: readinessAttributes,
              message: "Resumed sandbox runtime readiness wait started.",
              phase: "ready",
              status: "started",
            });
            resumedSandboxRuntimeReady = await step.run(
              { name: "wait-for-resumed-sandbox-runtime-readiness" },
              async () => {
                return waitForSandboxRuntimeReadiness(
                  {
                    runtimeStateReader: ctx.runtimeStateReader,
                    policy: ctx.tunnelReadinessPolicy,
                    clock: ctx.clock,
                    sleeper: ctx.sleeper,
                  },
                  {
                    sandboxInstanceId: input.sandboxInstanceId,
                  },
                );
              },
            );
            if (resumedSandboxRuntimeReady) {
              await operationEvents.record({
                attributes: readinessAttributes,
                message: "Resumed sandbox runtime readiness wait completed.",
                phase: "ready",
                status: "completed",
              });
            }
            logger.info(
              {
                ...createResumeWorkflowLogFields({
                  sandboxInstanceId: input.sandboxInstanceId,
                  organizationId: resumableSandboxState.organizationId,
                  runtimeProvider: resumedRuntime.runtimeProvider,
                  providerSandboxId: resumedRuntime.providerSandboxId,
                  persistenceMode: resumableSandboxState.persistenceMode,
                  computeGeneration: resumableSandboxState.computeGeneration,
                }),
                didSandboxBecomeReady: resumedSandboxRuntimeReady,
              },
              "Finished waiting for resumed sandbox runtime readiness.",
            );
          } catch (error) {
            rethrowResumeDurableStepErrorForRetry(error);
            await operationEvents.record({
              attributes: {
                providerSandboxId: resumedRuntime.providerSandboxId,
                runtimeProvider: resumedRuntime.runtimeProvider,
              },
              message: "Resumed sandbox runtime readiness wait failed.",
              phase: "ready",
              status: "failed",
            });
            existingResumeFailureHandled = true;
            const failureMessage = formatPersistedFailureMessage({
              summary: "Failed while waiting for resumed sandbox runtime readiness.",
              error,
            });

            let stopSandboxError: unknown;
            try {
              await step.run({ name: "stop-sandbox-after-resume-failure" }, async () => {
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
                    persistenceMode: resumableSandboxState.persistenceMode,
                    runtimeProvider: resumedRuntime.runtimeProvider,
                    providerSandboxId: resumedRuntime.providerSandboxId,
                  },
                );
              });
            } catch (stopError) {
              if (!isRecoverableMissingSandboxError(stopError)) {
                logger.error({ err: stopError }, "Failed to stop sandbox after resume failure.");
                stopSandboxError = stopError;
              }
            }

            let markFailedError: unknown;
            logger.warn(
              {
                failureCode: ResumeSandboxFailureCodes.TUNNEL_CONNECT_ACK_WAIT_FAILED,
                failureMessage,
              },
              "Marking sandbox instance as failed during resume workflow.",
            );
            try {
              await step.run(
                { name: "mark-sandbox-instance-failed-after-resume-failure" },
                async () => {
                  await markSandboxInstanceFailed(
                    {
                      db: ctx.db,
                      tables: ctx.tables,
                    },
                    {
                      sandboxInstanceId: input.sandboxInstanceId,
                      failureCode: ResumeSandboxFailureCodes.TUNNEL_CONNECT_ACK_WAIT_FAILED,
                      failureMessage,
                    },
                  );
                },
              );
            } catch (markError) {
              logger.error(
                { err: markError },
                "Failed to mark sandbox instance as failed after resume failure.",
              );
              markFailedError = markError;
            }

            throwResumeFailureHandlingErrors({
              stopSandboxError,
              markFailedError,
            });
            throw error;
          }

          if (!resumedSandboxRuntimeReady) {
            await operationEvents.record({
              attributes: {
                providerSandboxId: resumedRuntime.providerSandboxId,
                runtimeProvider: resumedRuntime.runtimeProvider,
                timeoutMs: ctx.tunnelReadinessPolicy.timeoutMs,
              },
              message: "Resumed sandbox runtime readiness timed out.",
              phase: "ready",
              status: "failed",
            });
            const error = new Error("Timed out waiting for resumed sandbox runtime readiness.");
            existingResumeFailureHandled = true;
            let stopSandboxError: unknown;
            try {
              await step.run({ name: "stop-sandbox-after-resume-failure" }, async () => {
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
                    persistenceMode: resumableSandboxState.persistenceMode,
                    runtimeProvider: resumedRuntime.runtimeProvider,
                    providerSandboxId: resumedRuntime.providerSandboxId,
                  },
                );
              });
            } catch (stopError) {
              if (!isRecoverableMissingSandboxError(stopError)) {
                logger.error({ err: stopError }, "Failed to stop sandbox after resume failure.");
                stopSandboxError = stopError;
              }
            }

            let markFailedError: unknown;
            logger.warn(
              {
                failureCode: ResumeSandboxFailureCodes.TUNNEL_CONNECT_ACK_TIMEOUT,
                failureMessage: error.message,
              },
              "Marking sandbox instance as failed during resume workflow.",
            );
            try {
              await step.run(
                { name: "mark-sandbox-instance-failed-after-resume-failure" },
                async () => {
                  await markSandboxInstanceFailed(
                    {
                      db: ctx.db,
                      tables: ctx.tables,
                    },
                    {
                      sandboxInstanceId: input.sandboxInstanceId,
                      failureCode: ResumeSandboxFailureCodes.TUNNEL_CONNECT_ACK_TIMEOUT,
                      failureMessage: error.message,
                    },
                  );
                },
              );
            } catch (markError) {
              logger.error(
                { err: markError },
                "Failed to mark sandbox instance as failed after resume failure.",
              );
              markFailedError = markError;
            }

            throwResumeFailureHandlingErrors({
              stopSandboxError,
              markFailedError,
            });
            throw error;
          }

          try {
            logger.info(
              createResumeWorkflowLogFields({
                sandboxInstanceId: input.sandboxInstanceId,
                organizationId: resumableSandboxState.organizationId,
                runtimeProvider: resumedRuntime.runtimeProvider,
                providerSandboxId: resumedRuntime.providerSandboxId,
                persistenceMode: resumableSandboxState.persistenceMode,
                computeGeneration: resumableSandboxState.computeGeneration,
              }),
              "Marking resumed sandbox instance as running.",
            );
            await recordWorkerSandboxLifecyclePhase(
              operationEvents,
              {
                attributes: {
                  providerSandboxId: resumedRuntime.providerSandboxId,
                  runtimeProvider: resumedRuntime.runtimeProvider,
                  timelineHidden: true,
                },
                completedMessage: "Resumed sandbox running status transition completed.",
                failedMessage: "Resumed sandbox running status transition failed.",
                phase: "running",
                startedMessage: "Resumed sandbox running status transition started.",
              },
              async () => {
                await step.run({ name: "mark-resumed-sandbox-instance-running" }, async () => {
                  await markSandboxInstanceRunning(
                    {
                      db: ctx.db,
                      tables: ctx.tables,
                    },
                    {
                      sandboxInstanceId: input.sandboxInstanceId,
                    },
                  );
                });
              },
            );
            logger.info(
              createResumeWorkflowLogFields({
                sandboxInstanceId: input.sandboxInstanceId,
                organizationId: resumableSandboxState.organizationId,
                runtimeProvider: resumedRuntime.runtimeProvider,
                providerSandboxId: resumedRuntime.providerSandboxId,
                persistenceMode: resumableSandboxState.persistenceMode,
                computeGeneration: resumableSandboxState.computeGeneration,
              }),
              "Sandbox resume workflow completed successfully.",
            );
            await emitSandboxStartupDiagnostics({
              logger,
              sandboxRuntimeControl: resolvedRuntime.sandboxRuntimeControl,
              providerSandboxId: resumedRuntime.providerSandboxId,
              sandboxInstanceId: resumedRuntime.sandboxInstanceId,
              runtimeProvider: resumedRuntime.runtimeProvider,
              operation: "resume",
              persistenceMode: resumableSandboxState.persistenceMode,
            });
          } catch (error) {
            rethrowResumeDurableStepErrorForRetry(error);
            existingResumeFailureHandled = true;
            const failureMessage = formatPersistedFailureMessage({
              summary: "Failed to mark resumed sandbox instance as running.",
              error,
            });

            let stopSandboxError: unknown;
            try {
              await step.run({ name: "stop-sandbox-after-resume-failure" }, async () => {
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
                    persistenceMode: resumableSandboxState.persistenceMode,
                    runtimeProvider: resumedRuntime.runtimeProvider,
                    providerSandboxId: resumedRuntime.providerSandboxId,
                  },
                );
              });
            } catch (stopError) {
              if (!isRecoverableMissingSandboxError(stopError)) {
                logger.error({ err: stopError }, "Failed to stop sandbox after resume failure.");
                stopSandboxError = stopError;
              }
            }

            let markFailedError: unknown;
            logger.warn(
              {
                failureCode: ResumeSandboxFailureCodes.STATUS_TRANSITION_TO_RUNNING_FAILED,
                failureMessage,
              },
              "Marking sandbox instance as failed during resume workflow.",
            );
            try {
              await step.run(
                { name: "mark-sandbox-instance-failed-after-resume-failure" },
                async () => {
                  await markSandboxInstanceFailed(
                    {
                      db: ctx.db,
                      tables: ctx.tables,
                    },
                    {
                      sandboxInstanceId: input.sandboxInstanceId,
                      failureCode: ResumeSandboxFailureCodes.STATUS_TRANSITION_TO_RUNNING_FAILED,
                      failureMessage,
                    },
                  );
                },
              );
            } catch (markError) {
              logger.error(
                { err: markError },
                "Failed to mark sandbox instance as failed after resume failure.",
              );
              markFailedError = markError;
            }

            throwResumeFailureHandlingErrors({
              stopSandboxError,
              markFailedError,
            });
            throw error;
          }

          try {
            await step.run({ name: "record-resumed-sandbox-ready-usage-event" }, async () => {
              await recordResumeSandboxUsageEvent({
                eventType: SandboxUsageEventTypes.SANDBOX_READY,
                providerSandboxId: resumedRuntime.providerSandboxId,
                computeGeneration: resumableSandboxState.computeGeneration,
                discriminator: "existing-provider",
              });
            });
          } catch (error) {
            existingResumeFailureHandled = true;
            throw error;
          }

          return {
            sandboxInstanceId: input.sandboxInstanceId,
          };
        }
      } catch (error) {
        rethrowResumeDurableStepErrorForRetry(error);
        if (existingResumeFailureHandled) {
          throw error;
        }

        if (
          resumableSandboxState.persistenceMode !== "persistent" ||
          !isRecoverableMissingSandboxError(error)
        ) {
          const failureMessage = formatPersistedFailureMessage({
            summary: "Failed to resume sandbox runtime.",
            error,
          });

          let markFailedError: unknown;
          logger.warn(
            {
              failureCode: ResumeSandboxFailureCodes.RESUME_SANDBOX_FAILED,
              failureMessage,
            },
            "Marking sandbox instance as failed during resume workflow.",
          );
          try {
            await step.run(
              { name: "mark-sandbox-instance-failed-after-resume-failure" },
              async () => {
                await markSandboxInstanceFailed(
                  {
                    db: ctx.db,
                    tables: ctx.tables,
                  },
                  {
                    sandboxInstanceId: input.sandboxInstanceId,
                    failureCode: ResumeSandboxFailureCodes.RESUME_SANDBOX_FAILED,
                    failureMessage,
                  },
                );
              },
            );
          } catch (markError) {
            logger.error(
              { err: markError },
              "Failed to mark sandbox instance as failed after resume failure.",
            );
            markFailedError = markError;
          }

          throwResumeFailureHandlingErrors({
            markFailedError,
          });
          throw error;
        }
      }
    } else if (resumableSandboxState.persistenceMode !== "persistent") {
      const error = new Error(
        `Expected resumable sandbox instance '${input.sandboxInstanceId}' to have a provider sandbox id.`,
      );
      const failureMessage = formatPersistedFailureMessage({
        summary: "Failed to resume sandbox runtime.",
        error,
      });

      let markFailedError: unknown;
      logger.warn(
        {
          failureCode: ResumeSandboxFailureCodes.RESUME_SANDBOX_FAILED,
          failureMessage,
        },
        "Marking sandbox instance as failed during resume workflow.",
      );
      try {
        await step.run({ name: "mark-sandbox-instance-failed-after-resume-failure" }, async () => {
          await markSandboxInstanceFailed(
            {
              db: ctx.db,
              tables: ctx.tables,
            },
            {
              sandboxInstanceId: input.sandboxInstanceId,
              failureCode: ResumeSandboxFailureCodes.RESUME_SANDBOX_FAILED,
              failureMessage,
            },
          );
        });
      } catch (markError) {
        logger.error(
          { err: markError },
          "Failed to mark sandbox instance as failed after resume failure.",
        );
        markFailedError = markError;
      }

      throwResumeFailureHandlingErrors({
        markFailedError,
      });
      throw error;
    }

    const replacementImage = createReplacementSandboxImage({
      runtimePlan: resumableSandboxState.runtimePlan,
      runtimeProvider: resumableSandboxState.runtimeProvider,
    });
    let replacementSandbox:
      | {
          sandboxInstanceId: string;
          runtimeProvider: SandboxProvider;
          providerSandboxId: string;
        }
      | undefined;
    let persistedReplacement:
      | {
          computeGeneration: number;
        }
      | undefined;
    let replacementFailureHandled = false;

    try {
      const preparedReplacementImage = await step.run(
        { name: "prepare-replacement-sandbox-image" },
        async () => {
          const imagePreparationRuntime =
            await ctx.sandboxRuntimeProviderResolver.resolveForImagePreparation(
              createResolveSandboxRuntimeInput(resumableSandboxState),
            );

          return prepareSandboxImage(
            {
              sandboxAdapter: imagePreparationRuntime.sandboxAdapter,
            },
            {
              image: replacementImage,
              runtimeProvider: resumableSandboxState.runtimeProvider,
            },
          );
        },
      );
      const storagePreparation = await step.run(
        { name: "prepare-replacement-sandbox-storage-for-start" },
        async () => {
          return prepareSandboxStorageForStart(
            {
              db: ctx.db,
              tables: ctx.tables,
              controlPlaneInternalClient: ctx.controlPlaneInternalClient,
              workerConfig: ctx.config.app,
              configuredSandboxProvider: resumableSandboxState.runtimeProvider,
              sandboxAdapter: resolvedRuntime.sandboxAdapter,
              storageBackend: ctx.config.sandbox.storage?.backend,
            },
            {
              organizationId: resumableSandboxState.organizationId,
              sandboxInstanceId: resumableSandboxState.sandboxInstanceId,
              image: preparedReplacementImage,
              persistenceMode: resumableSandboxState.persistenceMode,
              runtimeProvider: resumableSandboxState.runtimeProvider,
            },
          );
        },
      );

      const startedReplacementSandbox = await recordWorkerSandboxLifecyclePhase(
        operationEvents,
        {
          attributes: {
            runtimeProvider: resumableSandboxState.runtimeProvider,
            timelineKey: "sandbox",
            timelineLabel: "Creating sandbox",
          },
          completedMessage: "Replacement sandbox provider start completed.",
          failedMessage: "Replacement sandbox provider start failed.",
          phase: "provider",
          startedMessage: "Replacement sandbox provider start started.",
        },
        async () => {
          return step.run({ name: "start-replacement-sandbox-compute" }, async () => {
            return startSandbox(
              {
                config: ctx.config,
                processEnv: ctx.processEnv,
                sandboxAdapter: resolvedRuntime.sandboxAdapter,
              },
              {
                sandboxInstanceId: resumableSandboxState.sandboxInstanceId,
                image: preparedReplacementImage,
                runtimeProvider: resumableSandboxState.runtimeProvider,
                storagePreparation,
              },
            );
          });
        },
      );
      replacementSandbox = startedReplacementSandbox;
      const replacementSandboxInstanceId = startedReplacementSandbox.sandboxInstanceId;
      const replacementRuntimeProvider = startedReplacementSandbox.runtimeProvider;
      const replacementProviderSandboxId = startedReplacementSandbox.providerSandboxId;

      persistedReplacement = await step.run(
        { name: "persist-sandbox-instance-compute-replacement" },
        async () => {
          return persistSandboxInstanceComputeReplacement(
            {
              db: ctx.db,
              logger,
              tables: ctx.tables,
            },
            {
              sandboxInstanceId: resumableSandboxState.sandboxInstanceId,
              providerSandboxId: replacementProviderSandboxId,
              previousComputeGeneration: resumableSandboxState.computeGeneration,
            },
          );
        },
      );
      const replacementComputeGeneration = persistedReplacement.computeGeneration;
      await step.run({ name: "record-sandbox-replaced-usage-event" }, async () => {
        await recordResumeSandboxUsageEvent({
          eventType: SandboxUsageEventTypes.SANDBOX_REPLACED,
          providerSandboxId: replacementProviderSandboxId,
          computeGeneration: replacementComputeGeneration,
          payload: {
            previousComputeGeneration: resumableSandboxState.computeGeneration,
            previousProviderSandboxId: resumableSandboxState.providerSandboxId,
          },
        });
      });

      try {
        await step.run({ name: "attach-replacement-sandbox-storage" }, async () => {
          await attachSandboxStorage(
            {
              db: ctx.db,
              tables: ctx.tables,
              controlPlaneInternalClient: ctx.controlPlaneInternalClient,
              workerConfig: ctx.config.app,
              configuredSandboxProvider: resumableSandboxState.runtimeProvider,
              sandboxAdapter: resolvedRuntime.sandboxAdapter,
              storageBackend: ctx.config.sandbox.storage?.backend,
            },
            {
              organizationId: resumableSandboxState.organizationId,
              sandboxInstanceId: resumableSandboxState.sandboxInstanceId,
              persistenceMode: resumableSandboxState.persistenceMode,
              runtimeProvider: replacementRuntimeProvider,
              providerSandboxId: replacementProviderSandboxId,
              lifecycle: "resume",
              operationEventRecorder: operationEvents,
            },
          );
        });
      } catch (error) {
        rethrowResumeDurableStepErrorForRetry(error);
        replacementFailureHandled = true;
        const failureMessage = formatPersistedFailureMessage({
          summary: "Failed to attach sandbox storage before replacement runtime initialization.",
          error,
        });

        let revertReplacementError: unknown;
        try {
          await step.run(
            { name: "revert-sandbox-instance-compute-replacement-after-resume-failure" },
            async () => {
              await revertSandboxInstanceComputeReplacement(
                {
                  db: ctx.db,
                  tables: ctx.tables,
                },
                {
                  sandboxInstanceId: input.sandboxInstanceId,
                  replacementProviderSandboxId,
                  replacementComputeGeneration,
                  previousProviderSandboxId: resumableSandboxState.providerSandboxId,
                  previousComputeGeneration: resumableSandboxState.computeGeneration,
                },
              );
            },
          );
        } catch (revertError) {
          logger.error(
            { err: revertError },
            "Failed to revert replacement provider sandbox id after resume failure.",
          );
          revertReplacementError = revertError;
        }

        let destroyReplacementError: unknown;
        try {
          await step.run({ name: "destroy-replacement-sandbox-after-resume-failure" }, async () => {
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
                organizationId: resumableSandboxState.organizationId,
                persistenceMode: resumableSandboxState.persistenceMode,
                runtimeProvider: replacementRuntimeProvider,
                providerSandboxId: replacementProviderSandboxId,
                skipPersistentStorageDeprovision: true,
              },
            );
          });
        } catch (destroyError) {
          if (!isRecoverableMissingSandboxError(destroyError)) {
            logger.error(
              { err: destroyError },
              "Failed to destroy replacement sandbox after resume failure.",
            );
            destroyReplacementError = destroyError;
          }
        }

        let markFailedError: unknown;
        logger.warn(
          {
            failureCode: ResumeSandboxFailureCodes.SANDBOX_INIT_FAILED,
            failureMessage,
          },
          "Marking sandbox instance as failed during resume workflow.",
        );
        try {
          await step.run(
            { name: "mark-sandbox-instance-failed-after-resume-failure" },
            async () => {
              await markSandboxInstanceFailed(
                {
                  db: ctx.db,
                  tables: ctx.tables,
                },
                {
                  sandboxInstanceId: input.sandboxInstanceId,
                  failureCode: ResumeSandboxFailureCodes.SANDBOX_INIT_FAILED,
                  failureMessage,
                },
              );
            },
          );
        } catch (markError) {
          logger.error(
            { err: markError },
            "Failed to mark sandbox instance as failed after replacement resume failure.",
          );
          markFailedError = markError;
        }

        throwReplacementFailureHandlingErrors({
          revertReplacementError,
          destroyReplacementError,
          markFailedError,
        });
        throw error;
      }

      try {
        await step.run({ name: "mark-replacement-sandbox-instance-initializing" }, async () => {
          await applySandboxLifecycleEvent(
            {
              db: ctx.db,
              logger,
              tables: ctx.tables,
            },
            {
              sandboxInstanceId: input.sandboxInstanceId,
              event: SandboxLifecycleEvents.PROVIDER_RUNTIME_INITIALIZATION_STARTED,
            },
          );
        });

        await step.run({ name: "initialize-replacement-sandbox-runtime" }, async () => {
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
              organizationId: resumableSandboxState.organizationId,
              operationId: run.id,
              operationKind: "resume",
              sandboxInstanceId: replacementSandboxInstanceId,
              providerSandboxId: replacementProviderSandboxId,
              startupMode: "new",
              runtimePlan: resumableSandboxState.runtimePlan,
              ...(input.actingUserId === undefined ? {} : { actingUserId: input.actingUserId }),
              ...(input.gitIdentity === undefined ? {} : { gitIdentity: input.gitIdentity }),
            },
          );
        });
      } catch (error) {
        rethrowResumeDurableStepErrorForRetry(error);
        replacementFailureHandled = true;
        const failureMessage = formatPersistedFailureMessage({
          summary: "Failed to initialize replacement sandbox runtime.",
          error,
        });

        let revertReplacementError: unknown;
        try {
          await step.run(
            { name: "revert-sandbox-instance-compute-replacement-after-resume-failure" },
            async () => {
              await revertSandboxInstanceComputeReplacement(
                {
                  db: ctx.db,
                  tables: ctx.tables,
                },
                {
                  sandboxInstanceId: input.sandboxInstanceId,
                  replacementProviderSandboxId,
                  replacementComputeGeneration,
                  previousProviderSandboxId: resumableSandboxState.providerSandboxId,
                  previousComputeGeneration: resumableSandboxState.computeGeneration,
                },
              );
            },
          );
        } catch (revertError) {
          logger.error(
            { err: revertError },
            "Failed to revert replacement provider sandbox id after resume failure.",
          );
          revertReplacementError = revertError;
        }

        let destroyReplacementError: unknown;
        try {
          await step.run({ name: "destroy-replacement-sandbox-after-resume-failure" }, async () => {
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
                organizationId: resumableSandboxState.organizationId,
                persistenceMode: resumableSandboxState.persistenceMode,
                runtimeProvider: replacementRuntimeProvider,
                providerSandboxId: replacementProviderSandboxId,
                skipPersistentStorageDeprovision: true,
              },
            );
          });
        } catch (destroyError) {
          if (!isRecoverableMissingSandboxError(destroyError)) {
            logger.error(
              { err: destroyError },
              "Failed to destroy replacement sandbox after resume failure.",
            );
            destroyReplacementError = destroyError;
          }
        }

        let markFailedError: unknown;
        logger.warn(
          {
            failureCode: ResumeSandboxFailureCodes.SANDBOX_INIT_FAILED,
            failureMessage,
          },
          "Marking sandbox instance as failed during resume workflow.",
        );
        try {
          await step.run(
            { name: "mark-sandbox-instance-failed-after-resume-failure" },
            async () => {
              await markSandboxInstanceFailed(
                {
                  db: ctx.db,
                  tables: ctx.tables,
                },
                {
                  sandboxInstanceId: input.sandboxInstanceId,
                  failureCode: ResumeSandboxFailureCodes.SANDBOX_INIT_FAILED,
                  failureMessage,
                },
              );
            },
          );
        } catch (markError) {
          logger.error(
            { err: markError },
            "Failed to mark sandbox instance as failed after replacement resume failure.",
          );
          markFailedError = markError;
        }

        throwReplacementFailureHandlingErrors({
          revertReplacementError,
          destroyReplacementError,
          markFailedError,
        });
        throw error;
      }

      let replacementSandboxRuntimeReady: boolean;
      try {
        const readinessAttributes = {
          providerSandboxId: replacementProviderSandboxId,
          runtimeProvider: replacementRuntimeProvider,
        };
        await operationEvents.record({
          attributes: readinessAttributes,
          message: "Replacement sandbox runtime readiness wait started.",
          phase: "ready",
          status: "started",
        });
        replacementSandboxRuntimeReady = await step.run(
          { name: "wait-for-replacement-sandbox-runtime-readiness" },
          async () => {
            return waitForSandboxRuntimeReadiness(
              {
                runtimeStateReader: ctx.runtimeStateReader,
                policy: ctx.tunnelReadinessPolicy,
                clock: ctx.clock,
                sleeper: ctx.sleeper,
              },
              {
                sandboxInstanceId: input.sandboxInstanceId,
              },
            );
          },
        );
        if (replacementSandboxRuntimeReady) {
          await operationEvents.record({
            attributes: readinessAttributes,
            message: "Replacement sandbox runtime readiness wait completed.",
            phase: "ready",
            status: "completed",
          });
        }
      } catch (error) {
        rethrowResumeDurableStepErrorForRetry(error);
        await operationEvents.record({
          attributes: {
            providerSandboxId: replacementProviderSandboxId,
            runtimeProvider: replacementRuntimeProvider,
          },
          message: "Replacement sandbox runtime readiness wait failed.",
          phase: "ready",
          status: "failed",
        });
        replacementFailureHandled = true;
        const failureMessage = formatPersistedFailureMessage({
          summary: "Failed while waiting for replacement sandbox runtime readiness.",
          error,
        });

        let revertReplacementError: unknown;
        try {
          await step.run(
            { name: "revert-sandbox-instance-compute-replacement-after-resume-failure" },
            async () => {
              await revertSandboxInstanceComputeReplacement(
                {
                  db: ctx.db,
                  tables: ctx.tables,
                },
                {
                  sandboxInstanceId: input.sandboxInstanceId,
                  replacementProviderSandboxId,
                  replacementComputeGeneration,
                  previousProviderSandboxId: resumableSandboxState.providerSandboxId,
                  previousComputeGeneration: resumableSandboxState.computeGeneration,
                },
              );
            },
          );
        } catch (revertError) {
          logger.error(
            { err: revertError },
            "Failed to revert replacement provider sandbox id after resume failure.",
          );
          revertReplacementError = revertError;
        }

        let destroyReplacementError: unknown;
        try {
          await step.run({ name: "destroy-replacement-sandbox-after-resume-failure" }, async () => {
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
                organizationId: resumableSandboxState.organizationId,
                persistenceMode: resumableSandboxState.persistenceMode,
                runtimeProvider: replacementRuntimeProvider,
                providerSandboxId: replacementProviderSandboxId,
                skipPersistentStorageDeprovision: true,
              },
            );
          });
        } catch (destroyError) {
          if (!isRecoverableMissingSandboxError(destroyError)) {
            logger.error(
              { err: destroyError },
              "Failed to destroy replacement sandbox after resume failure.",
            );
            destroyReplacementError = destroyError;
          }
        }

        let markFailedError: unknown;
        logger.warn(
          {
            failureCode: ResumeSandboxFailureCodes.TUNNEL_CONNECT_ACK_WAIT_FAILED,
            failureMessage,
          },
          "Marking sandbox instance as failed during resume workflow.",
        );
        try {
          await step.run(
            { name: "mark-sandbox-instance-failed-after-resume-failure" },
            async () => {
              await markSandboxInstanceFailed(
                {
                  db: ctx.db,
                  tables: ctx.tables,
                },
                {
                  sandboxInstanceId: input.sandboxInstanceId,
                  failureCode: ResumeSandboxFailureCodes.TUNNEL_CONNECT_ACK_WAIT_FAILED,
                  failureMessage,
                },
              );
            },
          );
        } catch (markError) {
          logger.error(
            { err: markError },
            "Failed to mark sandbox instance as failed after replacement resume failure.",
          );
          markFailedError = markError;
        }

        throwReplacementFailureHandlingErrors({
          revertReplacementError,
          destroyReplacementError,
          markFailedError,
        });
        throw error;
      }

      if (!replacementSandboxRuntimeReady) {
        await operationEvents.record({
          attributes: {
            providerSandboxId: replacementProviderSandboxId,
            runtimeProvider: replacementRuntimeProvider,
            timeoutMs: ctx.tunnelReadinessPolicy.timeoutMs,
          },
          message: "Replacement sandbox runtime readiness timed out.",
          phase: "ready",
          status: "failed",
        });
        const error = new Error("Timed out waiting for replacement sandbox runtime readiness.");
        replacementFailureHandled = true;
        let revertReplacementError: unknown;
        try {
          await step.run(
            { name: "revert-sandbox-instance-compute-replacement-after-resume-failure" },
            async () => {
              await revertSandboxInstanceComputeReplacement(
                {
                  db: ctx.db,
                  tables: ctx.tables,
                },
                {
                  sandboxInstanceId: input.sandboxInstanceId,
                  replacementProviderSandboxId,
                  replacementComputeGeneration,
                  previousProviderSandboxId: resumableSandboxState.providerSandboxId,
                  previousComputeGeneration: resumableSandboxState.computeGeneration,
                },
              );
            },
          );
        } catch (revertError) {
          logger.error(
            { err: revertError },
            "Failed to revert replacement provider sandbox id after resume failure.",
          );
          revertReplacementError = revertError;
        }

        let destroyReplacementError: unknown;
        try {
          await step.run({ name: "destroy-replacement-sandbox-after-resume-failure" }, async () => {
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
                organizationId: resumableSandboxState.organizationId,
                persistenceMode: resumableSandboxState.persistenceMode,
                runtimeProvider: replacementRuntimeProvider,
                providerSandboxId: replacementProviderSandboxId,
                skipPersistentStorageDeprovision: true,
              },
            );
          });
        } catch (destroyError) {
          if (!isRecoverableMissingSandboxError(destroyError)) {
            logger.error(
              { err: destroyError },
              "Failed to destroy replacement sandbox after resume failure.",
            );
            destroyReplacementError = destroyError;
          }
        }

        let markFailedError: unknown;
        logger.warn(
          {
            failureCode: ResumeSandboxFailureCodes.TUNNEL_CONNECT_ACK_TIMEOUT,
            failureMessage: error.message,
          },
          "Marking sandbox instance as failed during resume workflow.",
        );
        try {
          await step.run(
            { name: "mark-sandbox-instance-failed-after-resume-failure" },
            async () => {
              await markSandboxInstanceFailed(
                {
                  db: ctx.db,
                  tables: ctx.tables,
                },
                {
                  sandboxInstanceId: input.sandboxInstanceId,
                  failureCode: ResumeSandboxFailureCodes.TUNNEL_CONNECT_ACK_TIMEOUT,
                  failureMessage: error.message,
                },
              );
            },
          );
        } catch (markError) {
          logger.error(
            { err: markError },
            "Failed to mark sandbox instance as failed after replacement resume failure.",
          );
          markFailedError = markError;
        }

        throwReplacementFailureHandlingErrors({
          revertReplacementError,
          destroyReplacementError,
          markFailedError,
        });
        throw error;
      }

      try {
        await recordWorkerSandboxLifecyclePhase(
          operationEvents,
          {
            attributes: {
              providerSandboxId: replacementProviderSandboxId,
              runtimeProvider: replacementRuntimeProvider,
              timelineHidden: true,
            },
            completedMessage: "Replacement sandbox running status transition completed.",
            failedMessage: "Replacement sandbox running status transition failed.",
            phase: "running",
            startedMessage: "Replacement sandbox running status transition started.",
          },
          async () => {
            await step.run({ name: "mark-replacement-sandbox-instance-running" }, async () => {
              await markSandboxInstanceRunning(
                {
                  db: ctx.db,
                  tables: ctx.tables,
                },
                {
                  sandboxInstanceId: input.sandboxInstanceId,
                },
              );
            });
          },
        );
      } catch (error) {
        rethrowResumeDurableStepErrorForRetry(error);
        replacementFailureHandled = true;
        const failureMessage = formatPersistedFailureMessage({
          summary: "Failed to mark replacement sandbox instance as running.",
          error,
        });

        let revertReplacementError: unknown;
        try {
          await step.run(
            { name: "revert-sandbox-instance-compute-replacement-after-resume-failure" },
            async () => {
              await revertSandboxInstanceComputeReplacement(
                {
                  db: ctx.db,
                  tables: ctx.tables,
                },
                {
                  sandboxInstanceId: input.sandboxInstanceId,
                  replacementProviderSandboxId,
                  replacementComputeGeneration,
                  previousProviderSandboxId: resumableSandboxState.providerSandboxId,
                  previousComputeGeneration: resumableSandboxState.computeGeneration,
                },
              );
            },
          );
        } catch (revertError) {
          logger.error(
            { err: revertError },
            "Failed to revert replacement provider sandbox id after resume failure.",
          );
          revertReplacementError = revertError;
        }

        let destroyReplacementError: unknown;
        try {
          await step.run({ name: "destroy-replacement-sandbox-after-resume-failure" }, async () => {
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
                organizationId: resumableSandboxState.organizationId,
                persistenceMode: resumableSandboxState.persistenceMode,
                runtimeProvider: replacementRuntimeProvider,
                providerSandboxId: replacementProviderSandboxId,
                skipPersistentStorageDeprovision: true,
              },
            );
          });
        } catch (destroyError) {
          if (!isRecoverableMissingSandboxError(destroyError)) {
            logger.error(
              { err: destroyError },
              "Failed to destroy replacement sandbox after resume failure.",
            );
            destroyReplacementError = destroyError;
          }
        }

        let markFailedError: unknown;
        logger.warn(
          {
            failureCode: ResumeSandboxFailureCodes.STATUS_TRANSITION_TO_RUNNING_FAILED,
            failureMessage,
          },
          "Marking sandbox instance as failed during resume workflow.",
        );
        try {
          await step.run(
            { name: "mark-sandbox-instance-failed-after-resume-failure" },
            async () => {
              await markSandboxInstanceFailed(
                {
                  db: ctx.db,
                  tables: ctx.tables,
                },
                {
                  sandboxInstanceId: input.sandboxInstanceId,
                  failureCode: ResumeSandboxFailureCodes.STATUS_TRANSITION_TO_RUNNING_FAILED,
                  failureMessage,
                },
              );
            },
          );
        } catch (markError) {
          logger.error(
            { err: markError },
            "Failed to mark sandbox instance as failed after replacement resume failure.",
          );
          markFailedError = markError;
        }

        throwReplacementFailureHandlingErrors({
          revertReplacementError,
          destroyReplacementError,
          markFailedError,
        });
        throw error;
      }
    } catch (error) {
      rethrowResumeDurableStepErrorForRetry(error);
      if (!replacementFailureHandled) {
        const failureMessage = formatPersistedFailureMessage({
          summary: "Failed to replace missing sandbox compute during resume.",
          error,
        });

        let revertReplacementError: unknown;
        if (replacementSandbox !== undefined && persistedReplacement !== undefined) {
          const replacementProviderSandboxId = replacementSandbox.providerSandboxId;
          const replacementComputeGeneration = persistedReplacement.computeGeneration;
          try {
            await step.run(
              { name: "revert-sandbox-instance-compute-replacement-after-resume-failure" },
              async () => {
                await revertSandboxInstanceComputeReplacement(
                  {
                    db: ctx.db,
                    tables: ctx.tables,
                  },
                  {
                    sandboxInstanceId: input.sandboxInstanceId,
                    replacementProviderSandboxId,
                    replacementComputeGeneration,
                    previousProviderSandboxId: resumableSandboxState.providerSandboxId,
                    previousComputeGeneration: resumableSandboxState.computeGeneration,
                  },
                );
              },
            );
          } catch (revertError) {
            logger.error(
              { err: revertError },
              "Failed to revert replacement provider sandbox id after resume failure.",
            );
            revertReplacementError = revertError;
          }
        }

        let destroyReplacementError: unknown;
        if (replacementSandbox !== undefined) {
          const replacementRuntimeProvider = replacementSandbox.runtimeProvider;
          const replacementProviderSandboxId = replacementSandbox.providerSandboxId;
          try {
            await step.run(
              { name: "destroy-replacement-sandbox-after-resume-failure" },
              async () => {
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
                    organizationId: resumableSandboxState.organizationId,
                    persistenceMode: resumableSandboxState.persistenceMode,
                    runtimeProvider: replacementRuntimeProvider,
                    providerSandboxId: replacementProviderSandboxId,
                    skipPersistentStorageDeprovision: true,
                  },
                );
              },
            );
          } catch (destroyError) {
            if (!isRecoverableMissingSandboxError(destroyError)) {
              logger.error(
                { err: destroyError },
                "Failed to destroy replacement sandbox after resume failure.",
              );
              destroyReplacementError = destroyError;
            }
          }
        }

        let markFailedError: unknown;
        logger.warn(
          {
            failureCode: ResumeSandboxFailureCodes.RESUME_SANDBOX_FAILED,
            failureMessage,
          },
          "Marking sandbox instance as failed during resume workflow.",
        );
        try {
          await step.run(
            { name: "mark-sandbox-instance-failed-after-resume-failure" },
            async () => {
              await markSandboxInstanceFailed(
                {
                  db: ctx.db,
                  tables: ctx.tables,
                },
                {
                  sandboxInstanceId: input.sandboxInstanceId,
                  failureCode: ResumeSandboxFailureCodes.RESUME_SANDBOX_FAILED,
                  failureMessage,
                },
              );
            },
          );
        } catch (markError) {
          logger.error(
            { err: markError },
            "Failed to mark sandbox instance as failed after replacement resume failure.",
          );
          markFailedError = markError;
        }

        throwReplacementFailureHandlingErrors({
          revertReplacementError,
          destroyReplacementError,
          markFailedError,
        });
      }
      throw error;
    }

    if (replacementSandbox !== undefined && persistedReplacement !== undefined) {
      await step.run({ name: "record-replacement-sandbox-ready-usage-event" }, async () => {
        await recordResumeSandboxUsageEvent({
          eventType: SandboxUsageEventTypes.SANDBOX_READY,
          providerSandboxId: replacementSandbox.providerSandboxId,
          computeGeneration: persistedReplacement.computeGeneration,
          discriminator: "replacement-provider",
        });
      });
    }

    if (resumableSandboxState.providerSandboxId !== null) {
      const replacedProviderSandboxId = resumableSandboxState.providerSandboxId;
      try {
        await step.run({ name: "cleanup-replaced-sandbox-compute" }, async () => {
          await resolvedRuntime.sandboxAdapter.destroy({
            id: replacedProviderSandboxId,
          });
        });
      } catch (error) {
        if (!isRecoverableMissingSandboxError(error)) {
          logger.warn(
            { err: error, providerSandboxId: replacedProviderSandboxId },
            "Failed to clean up replaced sandbox compute after successful resume.",
          );
        }
      }
    }

    return {
      sandboxInstanceId: input.sandboxInstanceId,
    };
  },
);

function createReplacementSandboxImage(input: {
  runtimePlan: ResumableSandboxInstanceState["runtimePlan"];
  runtimeProvider: SandboxProvider;
}): StartSandboxInstanceWorkflowImageInput {
  return {
    imageId: input.runtimePlan.image.imageRef,
    createdAt: new Date().toISOString(),
    kind: SandboxStartImageKinds.BASE,
    provider: input.runtimeProvider,
  };
}

function isRecoverableMissingSandboxError(error: unknown): boolean {
  return isSandboxResourceNotFoundError(error);
}

function throwResumeFailureHandlingErrors(input: {
  stopSandboxError?: unknown;
  markFailedError?: unknown;
}): void {
  if (input.stopSandboxError !== undefined && input.markFailedError !== undefined) {
    throw new Error(
      "Failed to stop sandbox and failed to mark sandbox instance as failed after resume failure.",
      {
        cause: {
          stopSandboxError: input.stopSandboxError,
          markFailedError: input.markFailedError,
        },
      },
    );
  }

  if (input.stopSandboxError !== undefined) {
    throw new Error("Failed to stop sandbox after resume failure.", {
      cause: input.stopSandboxError,
    });
  }

  if (input.markFailedError !== undefined) {
    throw new Error("Failed to mark sandbox instance as failed after resume failure.", {
      cause: input.markFailedError,
    });
  }
}

function throwReplacementFailureHandlingErrors(input: {
  revertReplacementError?: unknown;
  destroyReplacementError?: unknown;
  markFailedError?: unknown;
}): void {
  if (
    input.revertReplacementError !== undefined &&
    input.destroyReplacementError !== undefined &&
    input.markFailedError !== undefined
  ) {
    throw new Error(
      "Failed to revert replacement, failed to destroy replacement sandbox, and failed to mark sandbox instance as failed after replacement resume failure.",
      {
        cause: {
          revertReplacementError: input.revertReplacementError,
          destroyReplacementError: input.destroyReplacementError,
          markFailedError: input.markFailedError,
        },
      },
    );
  }

  if (input.revertReplacementError !== undefined && input.destroyReplacementError !== undefined) {
    throw new Error(
      "Failed to revert replacement and failed to destroy replacement sandbox after replacement resume failure.",
      {
        cause: {
          revertReplacementError: input.revertReplacementError,
          destroyReplacementError: input.destroyReplacementError,
        },
      },
    );
  }

  if (input.revertReplacementError !== undefined && input.markFailedError !== undefined) {
    throw new Error(
      "Failed to revert replacement and failed to mark sandbox instance as failed after replacement resume failure.",
      {
        cause: {
          revertReplacementError: input.revertReplacementError,
          markFailedError: input.markFailedError,
        },
      },
    );
  }

  if (input.destroyReplacementError !== undefined && input.markFailedError !== undefined) {
    throw new Error(
      "Failed to destroy replacement sandbox and failed to mark sandbox instance as failed after replacement resume failure.",
      {
        cause: {
          destroyReplacementError: input.destroyReplacementError,
          markFailedError: input.markFailedError,
        },
      },
    );
  }

  if (input.revertReplacementError !== undefined) {
    throw new Error("Failed to revert replacement sandbox compute after replacement failure.", {
      cause: input.revertReplacementError,
    });
  }

  if (input.destroyReplacementError !== undefined) {
    throw new Error("Failed to destroy replacement sandbox after replacement failure.", {
      cause: input.destroyReplacementError,
    });
  }

  if (input.markFailedError !== undefined) {
    throw new Error("Failed to mark sandbox instance as failed after replacement failure.", {
      cause: input.markFailedError,
    });
  }
}
