import { SandboxInstanceStatuses, sandboxInstances } from "@mistle/db/data-plane";
import {
  createDataPlaneWorker,
  type CreateDataPlaneWorkflowDefinitionsInput,
} from "@mistle/workflows/data-plane";
import { sql } from "drizzle-orm";

import type { DataPlaneWorkerConfig } from "../types.js";
import type { WorkerRuntimeResources } from "./resources.js";

function createWorkflowInputs(ctx: {
  resources: Pick<WorkerRuntimeResources, "db" | "sandboxAdapter">;
}): CreateDataPlaneWorkflowDefinitionsInput {
  return {
    startSandboxInstance: {
      startSandbox: async (workflowInput) => {
        const startedSandbox = await ctx.resources.sandboxAdapter.start({
          image: workflowInput.image,
        });

        return {
          provider: startedSandbox.provider,
          providerSandboxId: startedSandbox.sandboxId,
        };
      },
      stopSandbox: async (workflowInput) => {
        await ctx.resources.sandboxAdapter.stop({
          sandboxId: workflowInput.providerSandboxId,
        });
      },
      insertSandboxInstance: async (workflowInput) => {
        const insertedRows = await ctx.resources.db
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

export function createRuntimeWorker(ctx: {
  config: DataPlaneWorkerConfig;
  resources: Pick<WorkerRuntimeResources, "db" | "openWorkflow" | "sandboxAdapter">;
}): ReturnType<typeof createDataPlaneWorker> {
  return createDataPlaneWorker({
    openWorkflow: ctx.resources.openWorkflow,
    concurrency: ctx.config.workflow.concurrency,
    workflowInputs: createWorkflowInputs({
      resources: ctx.resources,
    }),
  });
}
