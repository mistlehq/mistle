import {
  SandboxInstanceProviders,
  SandboxInstanceStatuses,
  sandboxInstances,
} from "@mistle/db/data-plane";
import { createSandboxAdapter, SandboxProvider, type SandboxAdapter } from "@mistle/sandbox";
import {
  createDataPlaneWorker,
  type CreateDataPlaneWorkflowDefinitionsInput,
} from "@mistle/workflows/data-plane";
import { sql } from "drizzle-orm";

import type { DataPlaneWorkerConfig } from "../types.js";
import type { WorkerRuntimeResources } from "./resources.js";

function createSandboxRuntimeAdapter(config: DataPlaneWorkerConfig): SandboxAdapter {
  return createSandboxAdapter({
    provider: SandboxProvider.MODAL,
    modal: {
      tokenId: config.sandbox.modal.tokenId,
      tokenSecret: config.sandbox.modal.tokenSecret,
      appName: config.sandbox.modal.appName,
      environmentName: config.sandbox.modal.environmentName,
    },
  });
}

function createWorkflowInputs(input: {
  resources: Pick<WorkerRuntimeResources, "db">;
  sandboxAdapter: SandboxAdapter;
}): CreateDataPlaneWorkflowDefinitionsInput {
  return {
    startSandboxInstance: {
      startSandbox: async (workflowInput) => {
        const startedSandbox = await input.sandboxAdapter.start({
          image: workflowInput.image,
        });

        return {
          provider: SandboxInstanceProviders.MODAL,
          providerSandboxId: startedSandbox.sandboxId,
        };
      },
      stopSandbox: async (workflowInput) => {
        await input.sandboxAdapter.stop({
          sandboxId: workflowInput.providerSandboxId,
        });
      },
      insertSandboxInstance: async (workflowInput) => {
        const insertedRows = await input.resources.db
          .insert(sandboxInstances)
          .values({
            organizationId: workflowInput.organizationId,
            sandboxProfileId: workflowInput.sandboxProfileId,
            sandboxProfileVersion: workflowInput.sandboxProfileVersion,
            manifest: workflowInput.manifest,
            provider: workflowInput.provider,
            providerSandboxId: workflowInput.providerSandboxId,
            status: SandboxInstanceStatuses.RUNNING,
            startedByKind: workflowInput.startedBy.kind,
            startedById: workflowInput.startedBy.id,
            source: workflowInput.source,
            startedAt: sql`now()`,
          })
          .returning({
            id: sandboxInstances.id,
          });

        const sandboxInstance = insertedRows[0];
        if (sandboxInstance === undefined) {
          throw new Error("Failed to insert sandbox instance row.");
        }

        return {
          sandboxInstanceId: sandboxInstance.id,
        };
      },
    },
  };
}

export function createRuntimeWorker(input: {
  config: DataPlaneWorkerConfig;
  resources: Pick<WorkerRuntimeResources, "db" | "openWorkflow">;
}): ReturnType<typeof createDataPlaneWorker> {
  const sandboxAdapter = createSandboxRuntimeAdapter(input.config);

  return createDataPlaneWorker({
    openWorkflow: input.resources.openWorkflow,
    concurrency: input.config.workflow.concurrency,
    workflowInputs: createWorkflowInputs({
      resources: input.resources,
      sandboxAdapter,
    }),
  });
}
