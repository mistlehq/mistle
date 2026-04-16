import { type ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import type { DataPlaneDatabase } from "@mistle/db/data-plane";
import type { SandboxAdapter, SandboxRuntimeControl } from "@mistle/sandbox";
import { type SandboxProvider } from "@mistle/sandbox";
import type { StartSandboxInstanceWorkflowImageInput } from "@mistle/workflow-registry/data-plane";

import type { DataPlaneWorkerRuntimeConfig } from "../core/config.js";
import { attachSandboxStorage } from "../shared/attach-sandbox-storage.js";
import { formatPersistedFailureMessage } from "../shared/format-persisted-failure-message.js";
import { prepareSandboxStorageForStart } from "../shared/prepare-sandbox-storage-for-start.js";
import { initializeSandboxRuntime } from "../start-sandbox-instance/initialize-sandbox-runtime.js";
import { markSandboxInstanceFailed } from "../start-sandbox-instance/mark-sandbox-instance-failed.js";
import { startSandbox } from "../start-sandbox-instance/start-sandbox.js";
import { persistSandboxInstanceComputeReplacement } from "./persist-sandbox-instance-compute-replacement.js";
import type { ResumableSandboxInstanceState } from "./resolve-resumable-sandbox-instance-state.js";

function createReplacementSandboxImage(input: {
  runtimePlan: ResumableSandboxInstanceState["runtimePlan"];
}): StartSandboxInstanceWorkflowImageInput {
  return {
    imageId: input.runtimePlan.image.imageRef,
    createdAt: new Date().toISOString(),
  };
}

export async function replacePersistentSandboxCompute(input: {
  db: DataPlaneDatabase;
  controlPlaneInternalClient: ControlPlaneInternalClient;
  config: DataPlaneWorkerRuntimeConfig;
  sandboxAdapter: SandboxAdapter;
  sandboxRuntimeControl: SandboxRuntimeControl;
  resumableSandboxInstance: ResumableSandboxInstanceState;
}): Promise<{
  sandboxInstanceId: string;
  runtimeProvider: SandboxProvider;
  providerSandboxId: string;
}> {
  const replacementImage = createReplacementSandboxImage({
    runtimePlan: input.resumableSandboxInstance.runtimePlan,
  });

  async function handleFailedReplacement(inputFailure: {
    providerSandboxId?: string;
    failureCode: string;
    failureMessage: string;
  }): Promise<void> {
    let destroySandboxError: unknown;
    if (inputFailure.providerSandboxId !== undefined) {
      try {
        await input.sandboxAdapter.destroy({
          id: inputFailure.providerSandboxId,
        });
      } catch (error) {
        destroySandboxError = error;
      }
    }

    let markFailedError: unknown;
    try {
      await markSandboxInstanceFailed(
        {
          db: input.db,
        },
        {
          sandboxInstanceId: input.resumableSandboxInstance.sandboxInstanceId,
          failureCode: inputFailure.failureCode,
          failureMessage: inputFailure.failureMessage,
        },
      );
    } catch (error) {
      markFailedError = error;
    }

    if (destroySandboxError !== undefined && markFailedError !== undefined) {
      throw new Error(
        "Failed to destroy replacement sandbox and failed to mark sandbox instance as failed.",
        {
          cause: {
            destroySandboxError,
            markFailedError,
          },
        },
      );
    }

    if (destroySandboxError !== undefined) {
      throw new Error("Failed to destroy replacement sandbox after replacement failure.", {
        cause: destroySandboxError,
      });
    }

    if (markFailedError !== undefined) {
      throw new Error("Failed to mark sandbox instance as failed after replacement failure.", {
        cause: markFailedError,
      });
    }
  }

  let startedSandbox:
    | {
        sandboxInstanceId: string;
        runtimeProvider: SandboxProvider;
        providerSandboxId: string;
      }
    | undefined;

  try {
    const storagePreparation = await prepareSandboxStorageForStart(
      {
        db: input.db,
        controlPlaneInternalClient: input.controlPlaneInternalClient,
        workerConfig: input.config.app,
        configuredSandboxProvider: input.config.sandbox.provider,
        sandboxAdapter: input.sandboxAdapter,
        storageBackend: input.config.sandbox.storage?.backend,
      },
      {
        organizationId: input.resumableSandboxInstance.organizationId,
        sandboxInstanceId: input.resumableSandboxInstance.sandboxInstanceId,
        image: replacementImage,
        persistenceMode: input.resumableSandboxInstance.persistenceMode,
        runtimeProvider: input.resumableSandboxInstance.runtimeProvider,
      },
    );

    startedSandbox = await startSandbox(
      {
        config: input.config,
        sandboxAdapter: input.sandboxAdapter,
      },
      {
        sandboxInstanceId: input.resumableSandboxInstance.sandboxInstanceId,
        image: replacementImage,
        storagePreparation,
      },
    );

    await persistSandboxInstanceComputeReplacement(
      {
        db: input.db,
      },
      {
        sandboxInstanceId: input.resumableSandboxInstance.sandboxInstanceId,
        providerSandboxId: startedSandbox.providerSandboxId,
        previousComputeGeneration: input.resumableSandboxInstance.computeGeneration,
      },
    );

    await attachSandboxStorage(
      {
        db: input.db,
        controlPlaneInternalClient: input.controlPlaneInternalClient,
        workerConfig: input.config.app,
        configuredSandboxProvider: input.config.sandbox.provider,
        sandboxAdapter: input.sandboxAdapter,
        storageBackend: input.config.sandbox.storage?.backend,
      },
      {
        organizationId: input.resumableSandboxInstance.organizationId,
        sandboxInstanceId: input.resumableSandboxInstance.sandboxInstanceId,
        persistenceMode: input.resumableSandboxInstance.persistenceMode,
        runtimeProvider: startedSandbox.runtimeProvider,
        providerSandboxId: startedSandbox.providerSandboxId,
        lifecycle: "start",
      },
    );

    await initializeSandboxRuntime(
      {
        config: input.config,
        sandboxRuntimeControl: input.sandboxRuntimeControl,
      },
      {
        sandboxInstanceId: startedSandbox.sandboxInstanceId,
        providerSandboxId: startedSandbox.providerSandboxId,
        startupMode: "new",
        runtimePlan: input.resumableSandboxInstance.runtimePlan,
      },
    );

    return startedSandbox;
  } catch (error) {
    await handleFailedReplacement({
      ...(startedSandbox === undefined
        ? {}
        : {
            providerSandboxId: startedSandbox.providerSandboxId,
          }),
      failureCode: "resume_sandbox_failed",
      failureMessage: formatPersistedFailureMessage({
        summary: "Failed to replace missing sandbox compute during resume.",
        error,
      }),
    });
    throw error;
  }
}
