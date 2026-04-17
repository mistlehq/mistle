import { isSandboxResourceNotFoundError, type SandboxProvider } from "@mistle/sandbox";
import {
  type ResumeSandboxInstanceWorkflowOutput,
  ResumeSandboxInstanceWorkflowSpec,
  type StartSandboxInstanceWorkflowImageInput,
} from "@mistle/workflow-registry/data-plane";

import { getWorkflowContext } from "../core/context.js";
import { defineTracedDataPlaneWorkflow } from "../core/tracing.js";
import { attachSandboxStorage } from "../shared/attach-sandbox-storage.js";
import { destroySandbox } from "../shared/destroy-sandbox.js";
import { formatPersistedFailureMessage } from "../shared/format-persisted-failure-message.js";
import { prepareSandboxStorageForStart } from "../shared/prepare-sandbox-storage-for-start.js";
import { stopSandbox } from "../shared/stop-sandbox.js";
import { initializeSandboxRuntime } from "../start-sandbox-instance/initialize-sandbox-runtime.js";
import { markSandboxInstanceFailed } from "../start-sandbox-instance/mark-sandbox-instance-failed.js";
import { markSandboxInstanceRunning } from "../start-sandbox-instance/mark-sandbox-instance-running.js";
import { resumeSandboxRuntime } from "../start-sandbox-instance/resume-sandbox-runtime.js";
import { startSandbox } from "../start-sandbox-instance/start-sandbox.js";
import { waitForSandboxRuntimeReadiness } from "../start-sandbox-instance/wait-for-sandbox-runtime-readiness.js";
import { markSandboxInstanceStarting } from "./mark-sandbox-instance-starting.js";
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

function createReplacementSandboxImage(input: {
  runtimePlan: ResumableSandboxInstanceState["runtimePlan"];
}): StartSandboxInstanceWorkflowImageInput {
  return {
    imageId: input.runtimePlan.image.imageRef,
    createdAt: new Date().toISOString(),
  };
}

export const ResumeSandboxInstanceWorkflow = defineTracedDataPlaneWorkflow(
  ResumeSandboxInstanceWorkflowSpec,
  async ({ input, step }): Promise<ResumeSandboxInstanceWorkflowOutput> => {
    const ctx = await getWorkflowContext();
    const logger = ctx.logger.child({
      workflow: ResumeSandboxInstanceWorkflowSpec.name,
      sandboxInstanceId: input.sandboxInstanceId,
    });

    async function markSandboxInstanceFailedStep(inputFailure: {
      sandboxInstanceId: string;
      failureCode: string;
      failureMessage: string;
    }): Promise<void> {
      logger.warn(
        {
          failureCode: inputFailure.failureCode,
          failureMessage: inputFailure.failureMessage,
        },
        "Marking sandbox instance as failed during resume workflow.",
      );

      await step.run({ name: "mark-sandbox-instance-failed-after-resume-failure" }, async () => {
        await markSandboxInstanceFailed(
          {
            db: ctx.db,
          },
          inputFailure,
        );
      });
    }

    async function handleFailedResumeOfExistingCompute(inputFailure: {
      runtimeProvider?: SandboxProvider;
      providerSandboxId?: string;
      failureCode: string;
      failureMessage: string;
    }): Promise<void> {
      let stopSandboxError: unknown;
      const failedRuntimeProvider = inputFailure.runtimeProvider;
      const failedProviderSandboxId = inputFailure.providerSandboxId;
      if (failedRuntimeProvider !== undefined && failedProviderSandboxId !== undefined) {
        try {
          await step.run({ name: "stop-sandbox-after-resume-failure" }, async () => {
            await stopSandbox(
              {
                db: ctx.db,
                controlPlaneInternalClient: ctx.controlPlaneInternalClient,
                config: ctx.config,
                sandboxAdapter: ctx.sandboxAdapter,
              },
              {
                sandboxInstanceId: input.sandboxInstanceId,
                persistenceMode: resumableSandboxState.persistenceMode,
                runtimeProvider: failedRuntimeProvider,
                providerSandboxId: failedProviderSandboxId,
              },
            );
          });
        } catch (error) {
          if (!isSandboxResourceNotFoundError(error)) {
            logger.error({ err: error }, "Failed to stop sandbox after resume failure.");
            stopSandboxError = error;
          }
        }
      }

      let markFailedError: unknown;
      try {
        await markSandboxInstanceFailedStep({
          sandboxInstanceId: input.sandboxInstanceId,
          failureCode: inputFailure.failureCode,
          failureMessage: inputFailure.failureMessage,
        });
      } catch (error) {
        logger.error(
          { err: error },
          "Failed to mark sandbox instance as failed after resume failure.",
        );
        markFailedError = error;
      }

      if (stopSandboxError !== undefined && markFailedError !== undefined) {
        throw new Error(
          "Failed to stop sandbox and failed to mark sandbox instance as failed after resume failure.",
          {
            cause: {
              stopSandboxError,
              markFailedError,
            },
          },
        );
      }

      if (stopSandboxError !== undefined) {
        throw new Error("Failed to stop sandbox after resume failure.", {
          cause: stopSandboxError,
        });
      }

      if (markFailedError !== undefined) {
        throw new Error("Failed to mark sandbox instance as failed after resume failure.", {
          cause: markFailedError,
        });
      }
    }

    async function handleFailedReplacementResume(inputFailure: {
      replacementRuntimeProvider?: SandboxProvider;
      replacementProviderSandboxId?: string;
      replacementComputeGeneration?: number;
      previousProviderSandboxId: string | null;
      previousComputeGeneration: number;
      failureCode: string;
      failureMessage: string;
    }): Promise<void> {
      let revertReplacementError: unknown;
      const replacementProviderSandboxId = inputFailure.replacementProviderSandboxId;
      const replacementComputeGeneration = inputFailure.replacementComputeGeneration;
      if (
        replacementProviderSandboxId !== undefined &&
        replacementComputeGeneration !== undefined
      ) {
        try {
          await step.run(
            { name: "revert-sandbox-instance-compute-replacement-after-resume-failure" },
            async () => {
              await revertSandboxInstanceComputeReplacement(
                {
                  db: ctx.db,
                },
                {
                  sandboxInstanceId: input.sandboxInstanceId,
                  replacementProviderSandboxId,
                  replacementComputeGeneration,
                  previousProviderSandboxId: inputFailure.previousProviderSandboxId,
                  previousComputeGeneration: inputFailure.previousComputeGeneration,
                },
              );
            },
          );
        } catch (error) {
          logger.error(
            { err: error },
            "Failed to revert replacement provider sandbox id after resume failure.",
          );
          revertReplacementError = error;
        }
      }

      let destroyReplacementError: unknown;
      const replacementRuntimeProvider = inputFailure.replacementRuntimeProvider;
      if (replacementRuntimeProvider !== undefined && replacementProviderSandboxId !== undefined) {
        try {
          await step.run({ name: "destroy-replacement-sandbox-after-resume-failure" }, async () => {
            await destroySandbox(
              {
                db: ctx.db,
                controlPlaneInternalClient: ctx.controlPlaneInternalClient,
                config: ctx.config,
                sandboxAdapter: ctx.sandboxAdapter,
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
        } catch (error) {
          if (!isSandboxResourceNotFoundError(error)) {
            logger.error(
              { err: error },
              "Failed to destroy replacement sandbox after resume failure.",
            );
            destroyReplacementError = error;
          }
        }
      }

      let markFailedError: unknown;
      try {
        await markSandboxInstanceFailedStep({
          sandboxInstanceId: input.sandboxInstanceId,
          failureCode: inputFailure.failureCode,
          failureMessage: inputFailure.failureMessage,
        });
      } catch (error) {
        logger.error(
          { err: error },
          "Failed to mark sandbox instance as failed after replacement resume failure.",
        );
        markFailedError = error;
      }

      if (
        revertReplacementError !== undefined &&
        destroyReplacementError !== undefined &&
        markFailedError !== undefined
      ) {
        throw new Error(
          "Failed to revert replacement, failed to destroy replacement sandbox, and failed to mark sandbox instance as failed after replacement resume failure.",
          {
            cause: {
              revertReplacementError,
              destroyReplacementError,
              markFailedError,
            },
          },
        );
      }

      if (revertReplacementError !== undefined && destroyReplacementError !== undefined) {
        throw new Error(
          "Failed to revert replacement and failed to destroy replacement sandbox after replacement resume failure.",
          {
            cause: {
              revertReplacementError,
              destroyReplacementError,
            },
          },
        );
      }

      if (revertReplacementError !== undefined && markFailedError !== undefined) {
        throw new Error(
          "Failed to revert replacement and failed to mark sandbox instance as failed after replacement resume failure.",
          {
            cause: {
              revertReplacementError,
              markFailedError,
            },
          },
        );
      }

      if (destroyReplacementError !== undefined && markFailedError !== undefined) {
        throw new Error(
          "Failed to destroy replacement sandbox and failed to mark sandbox instance as failed after replacement resume failure.",
          {
            cause: {
              destroyReplacementError,
              markFailedError,
            },
          },
        );
      }

      if (revertReplacementError !== undefined) {
        throw new Error("Failed to revert replacement sandbox compute after replacement failure.", {
          cause: revertReplacementError,
        });
      }

      if (destroyReplacementError !== undefined) {
        throw new Error("Failed to destroy replacement sandbox after replacement failure.", {
          cause: destroyReplacementError,
        });
      }

      if (markFailedError !== undefined) {
        throw new Error("Failed to mark sandbox instance as failed after replacement failure.", {
          cause: markFailedError,
        });
      }
    }

    const resumableSandboxInstance = await step.run(
      { name: "resolve-resumable-sandbox-instance-state" },
      async () => {
        return resolveResumableSandboxInstanceState({
          db: ctx.db,
          sandboxInstanceId: input.sandboxInstanceId,
        });
      },
    );

    if (resumableSandboxInstance === null) {
      return {
        sandboxInstanceId: input.sandboxInstanceId,
      };
    }

    const resumableSandboxState = resumableSandboxInstance;

    await step.run({ name: "mark-sandbox-instance-starting" }, async () => {
      await markSandboxInstanceStarting({
        db: ctx.db,
        sandboxInstanceId: input.sandboxInstanceId,
      });
    });

    if (resumableSandboxState.providerSandboxId !== null) {
      const existingProviderSandboxId = resumableSandboxState.providerSandboxId;
      let existingResumeFailureHandled = false;
      try {
        const resumedRuntime = await step.run(
          { name: "resume-existing-sandbox-compute" },
          async () => {
            return resumeSandbox(
              {
                config: ctx.config,
                sandboxAdapter: ctx.sandboxAdapter,
              },
              {
                sandboxInstanceId: resumableSandboxState.sandboxInstanceId,
                providerSandboxId: existingProviderSandboxId,
              },
            );
          },
        );

        try {
          await step.run({ name: "attach-resumed-sandbox-storage" }, async () => {
            await attachSandboxStorage(
              {
                db: ctx.db,
                controlPlaneInternalClient: ctx.controlPlaneInternalClient,
                workerConfig: ctx.config.app,
                configuredSandboxProvider: ctx.config.sandbox.provider,
                sandboxAdapter: ctx.sandboxAdapter,
                storageBackend: ctx.config.sandbox.storage?.backend,
              },
              {
                organizationId: resumableSandboxState.organizationId,
                sandboxInstanceId: input.sandboxInstanceId,
                persistenceMode: resumableSandboxState.persistenceMode,
                runtimeProvider: resumedRuntime.runtimeProvider,
                providerSandboxId: resumedRuntime.providerSandboxId,
                lifecycle: "resume",
              },
            );
          });
        } catch (error) {
          existingResumeFailureHandled = true;
          await handleFailedResumeOfExistingCompute({
            runtimeProvider: resumedRuntime.runtimeProvider,
            providerSandboxId: resumedRuntime.providerSandboxId,
            failureCode: ResumeSandboxFailureCodes.SANDBOX_INIT_FAILED,
            failureMessage: formatPersistedFailureMessage({
              summary: "Failed to attach sandbox storage before resume runtime initialization.",
              error,
            }),
          });
          throw error;
        }

        try {
          await step.run({ name: "initialize-resumed-sandbox-runtime" }, async () => {
            await resumeSandboxRuntime(
              {
                config: ctx.config,
                sandboxRuntimeControl: ctx.sandboxRuntimeControl,
              },
              {
                sandboxInstanceId: resumedRuntime.sandboxInstanceId,
                providerSandboxId: resumedRuntime.providerSandboxId,
                runtimeProvider: resumedRuntime.runtimeProvider,
                runtimePlan: resumableSandboxState.runtimePlan,
              },
            );
          });
        } catch (error) {
          existingResumeFailureHandled = true;
          await handleFailedResumeOfExistingCompute({
            runtimeProvider: resumedRuntime.runtimeProvider,
            providerSandboxId: resumedRuntime.providerSandboxId,
            failureCode: ResumeSandboxFailureCodes.SANDBOX_INIT_FAILED,
            failureMessage: formatPersistedFailureMessage({
              summary: "Failed to initialize resumed sandbox runtime.",
              error,
            }),
          });
          throw error;
        }

        let resumedSandboxRuntimeReady: boolean;
        try {
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
        } catch (error) {
          existingResumeFailureHandled = true;
          await handleFailedResumeOfExistingCompute({
            runtimeProvider: resumedRuntime.runtimeProvider,
            providerSandboxId: resumedRuntime.providerSandboxId,
            failureCode: ResumeSandboxFailureCodes.TUNNEL_CONNECT_ACK_WAIT_FAILED,
            failureMessage: formatPersistedFailureMessage({
              summary: "Failed while waiting for resumed sandbox runtime readiness.",
              error,
            }),
          });
          throw error;
        }

        if (!resumedSandboxRuntimeReady) {
          const error = new Error("Timed out waiting for resumed sandbox runtime readiness.");
          existingResumeFailureHandled = true;
          await handleFailedResumeOfExistingCompute({
            runtimeProvider: resumedRuntime.runtimeProvider,
            providerSandboxId: resumedRuntime.providerSandboxId,
            failureCode: ResumeSandboxFailureCodes.TUNNEL_CONNECT_ACK_TIMEOUT,
            failureMessage: error.message,
          });
          throw error;
        }

        try {
          await step.run({ name: "mark-resumed-sandbox-instance-running" }, async () => {
            await markSandboxInstanceRunning(
              {
                db: ctx.db,
              },
              {
                sandboxInstanceId: input.sandboxInstanceId,
              },
            );
          });
        } catch (error) {
          existingResumeFailureHandled = true;
          await handleFailedResumeOfExistingCompute({
            runtimeProvider: resumedRuntime.runtimeProvider,
            providerSandboxId: resumedRuntime.providerSandboxId,
            failureCode: ResumeSandboxFailureCodes.STATUS_TRANSITION_TO_RUNNING_FAILED,
            failureMessage: formatPersistedFailureMessage({
              summary: "Failed to mark resumed sandbox instance as running.",
              error,
            }),
          });
          throw error;
        }

        return {
          sandboxInstanceId: input.sandboxInstanceId,
        };
      } catch (error) {
        if (existingResumeFailureHandled) {
          throw error;
        }

        if (
          resumableSandboxState.persistenceMode !== "persistent" ||
          !isSandboxResourceNotFoundError(error)
        ) {
          await handleFailedResumeOfExistingCompute({
            failureCode: ResumeSandboxFailureCodes.RESUME_SANDBOX_FAILED,
            failureMessage: formatPersistedFailureMessage({
              summary: "Failed to resume sandbox runtime.",
              error,
            }),
          });
          throw error;
        }
      }
    } else if (resumableSandboxState.persistenceMode !== "persistent") {
      const error = new Error(
        `Expected resumable sandbox instance '${input.sandboxInstanceId}' to have a provider sandbox id.`,
      );
      await handleFailedResumeOfExistingCompute({
        failureCode: ResumeSandboxFailureCodes.RESUME_SANDBOX_FAILED,
        failureMessage: formatPersistedFailureMessage({
          summary: "Failed to resume sandbox runtime.",
          error,
        }),
      });
      throw error;
    }

    const replacementImage = createReplacementSandboxImage({
      runtimePlan: resumableSandboxState.runtimePlan,
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
      const storagePreparation = await step.run(
        { name: "prepare-replacement-sandbox-storage-for-start" },
        async () => {
          return prepareSandboxStorageForStart(
            {
              db: ctx.db,
              controlPlaneInternalClient: ctx.controlPlaneInternalClient,
              workerConfig: ctx.config.app,
              configuredSandboxProvider: ctx.config.sandbox.provider,
              sandboxAdapter: ctx.sandboxAdapter,
              storageBackend: ctx.config.sandbox.storage?.backend,
            },
            {
              organizationId: resumableSandboxState.organizationId,
              sandboxInstanceId: resumableSandboxState.sandboxInstanceId,
              image: replacementImage,
              persistenceMode: resumableSandboxState.persistenceMode,
              runtimeProvider: resumableSandboxState.runtimeProvider,
            },
          );
        },
      );

      const startedReplacementSandbox = await step.run(
        { name: "start-replacement-sandbox-compute" },
        async () => {
          return startSandbox(
            {
              config: ctx.config,
              sandboxAdapter: ctx.sandboxAdapter,
            },
            {
              sandboxInstanceId: resumableSandboxState.sandboxInstanceId,
              image: replacementImage,
              storagePreparation,
            },
          );
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

      try {
        await step.run({ name: "attach-replacement-sandbox-storage" }, async () => {
          await attachSandboxStorage(
            {
              db: ctx.db,
              controlPlaneInternalClient: ctx.controlPlaneInternalClient,
              workerConfig: ctx.config.app,
              configuredSandboxProvider: ctx.config.sandbox.provider,
              sandboxAdapter: ctx.sandboxAdapter,
              storageBackend: ctx.config.sandbox.storage?.backend,
            },
            {
              organizationId: resumableSandboxState.organizationId,
              sandboxInstanceId: resumableSandboxState.sandboxInstanceId,
              persistenceMode: resumableSandboxState.persistenceMode,
              runtimeProvider: replacementRuntimeProvider,
              providerSandboxId: replacementProviderSandboxId,
              lifecycle: "start",
            },
          );
        });
      } catch (error) {
        replacementFailureHandled = true;
        await handleFailedReplacementResume({
          replacementRuntimeProvider,
          replacementProviderSandboxId,
          replacementComputeGeneration,
          previousProviderSandboxId: resumableSandboxState.providerSandboxId,
          previousComputeGeneration: resumableSandboxState.computeGeneration,
          failureCode: ResumeSandboxFailureCodes.SANDBOX_INIT_FAILED,
          failureMessage: formatPersistedFailureMessage({
            summary: "Failed to attach sandbox storage before replacement runtime initialization.",
            error,
          }),
        });
        throw error;
      }

      try {
        await step.run({ name: "initialize-replacement-sandbox-runtime" }, async () => {
          await initializeSandboxRuntime(
            {
              config: ctx.config,
              sandboxRuntimeControl: ctx.sandboxRuntimeControl,
            },
            {
              sandboxInstanceId: replacementSandboxInstanceId,
              providerSandboxId: replacementProviderSandboxId,
              startupMode: "new",
              runtimePlan: resumableSandboxState.runtimePlan,
            },
          );
        });
      } catch (error) {
        replacementFailureHandled = true;
        await handleFailedReplacementResume({
          replacementRuntimeProvider,
          replacementProviderSandboxId,
          replacementComputeGeneration,
          previousProviderSandboxId: resumableSandboxState.providerSandboxId,
          previousComputeGeneration: resumableSandboxState.computeGeneration,
          failureCode: ResumeSandboxFailureCodes.SANDBOX_INIT_FAILED,
          failureMessage: formatPersistedFailureMessage({
            summary: "Failed to initialize replacement sandbox runtime.",
            error,
          }),
        });
        throw error;
      }

      let replacementSandboxRuntimeReady: boolean;
      try {
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
      } catch (error) {
        replacementFailureHandled = true;
        await handleFailedReplacementResume({
          replacementRuntimeProvider,
          replacementProviderSandboxId,
          replacementComputeGeneration,
          previousProviderSandboxId: resumableSandboxState.providerSandboxId,
          previousComputeGeneration: resumableSandboxState.computeGeneration,
          failureCode: ResumeSandboxFailureCodes.TUNNEL_CONNECT_ACK_WAIT_FAILED,
          failureMessage: formatPersistedFailureMessage({
            summary: "Failed while waiting for replacement sandbox runtime readiness.",
            error,
          }),
        });
        throw error;
      }

      if (!replacementSandboxRuntimeReady) {
        const error = new Error("Timed out waiting for replacement sandbox runtime readiness.");
        replacementFailureHandled = true;
        await handleFailedReplacementResume({
          replacementRuntimeProvider,
          replacementProviderSandboxId,
          replacementComputeGeneration,
          previousProviderSandboxId: resumableSandboxState.providerSandboxId,
          previousComputeGeneration: resumableSandboxState.computeGeneration,
          failureCode: ResumeSandboxFailureCodes.TUNNEL_CONNECT_ACK_TIMEOUT,
          failureMessage: error.message,
        });
        throw error;
      }

      try {
        await step.run({ name: "mark-replacement-sandbox-instance-running" }, async () => {
          await markSandboxInstanceRunning(
            {
              db: ctx.db,
            },
            {
              sandboxInstanceId: input.sandboxInstanceId,
            },
          );
        });
      } catch (error) {
        replacementFailureHandled = true;
        await handleFailedReplacementResume({
          replacementRuntimeProvider,
          replacementProviderSandboxId,
          replacementComputeGeneration,
          previousProviderSandboxId: resumableSandboxState.providerSandboxId,
          previousComputeGeneration: resumableSandboxState.computeGeneration,
          failureCode: ResumeSandboxFailureCodes.STATUS_TRANSITION_TO_RUNNING_FAILED,
          failureMessage: formatPersistedFailureMessage({
            summary: "Failed to mark replacement sandbox instance as running.",
            error,
          }),
        });
        throw error;
      }
    } catch (error) {
      if (!replacementFailureHandled) {
        const replacementFailureInput = {
          previousProviderSandboxId: resumableSandboxState.providerSandboxId,
          previousComputeGeneration: resumableSandboxState.computeGeneration,
          failureCode: ResumeSandboxFailureCodes.RESUME_SANDBOX_FAILED,
          failureMessage: formatPersistedFailureMessage({
            summary: "Failed to replace missing sandbox compute during resume.",
            error,
          }),
          ...(replacementSandbox === undefined
            ? {}
            : {
                replacementRuntimeProvider: replacementSandbox.runtimeProvider,
                replacementProviderSandboxId: replacementSandbox.providerSandboxId,
              }),
          ...(persistedReplacement === undefined
            ? {}
            : {
                replacementComputeGeneration: persistedReplacement.computeGeneration,
              }),
        };
        await handleFailedReplacementResume(replacementFailureInput);
      }
      throw error;
    }

    if (resumableSandboxState.providerSandboxId !== null) {
      const replacedProviderSandboxId = resumableSandboxState.providerSandboxId;
      try {
        await step.run({ name: "cleanup-replaced-sandbox-compute" }, async () => {
          await ctx.sandboxAdapter.destroy({
            id: replacedProviderSandboxId,
          });
        });
      } catch (error) {
        if (!isSandboxResourceNotFoundError(error)) {
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
