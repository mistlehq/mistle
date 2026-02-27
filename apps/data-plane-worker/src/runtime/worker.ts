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

type RequiredEnvVar = "MODAL_TOKEN_ID" | "MODAL_TOKEN_SECRET" | "MISTLE_SANDBOX_MODAL_APP_NAME";

function requireEnvVar(envVar: RequiredEnvVar): string {
  const rawValue = process.env[envVar];
  if (rawValue === undefined) {
    throw new Error(`Expected environment variable ${envVar} to be set.`);
  }

  const value = rawValue.trim();
  if (value.length === 0) {
    throw new Error(`Expected environment variable ${envVar} to be non-empty.`);
  }

  return value;
}

function resolveOptionalNonEmptyEnvVar(
  envVar: "MISTLE_SANDBOX_MODAL_ENVIRONMENT",
): string | undefined {
  const rawValue = process.env[envVar];
  if (rawValue === undefined) {
    return undefined;
  }

  const value = rawValue.trim();
  if (value.length === 0) {
    throw new Error(`Expected environment variable ${envVar} to be non-empty when provided.`);
  }

  return value;
}

function createSandboxRuntimeAdapter(): SandboxAdapter {
  return createSandboxAdapter({
    provider: SandboxProvider.MODAL,
    modal: {
      tokenId: requireEnvVar("MODAL_TOKEN_ID"),
      tokenSecret: requireEnvVar("MODAL_TOKEN_SECRET"),
      appName: requireEnvVar("MISTLE_SANDBOX_MODAL_APP_NAME"),
      environmentName: resolveOptionalNonEmptyEnvVar("MISTLE_SANDBOX_MODAL_ENVIRONMENT"),
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
  const sandboxAdapter = createSandboxRuntimeAdapter();

  return createDataPlaneWorker({
    openWorkflow: input.resources.openWorkflow,
    concurrency: input.config.workflow.concurrency,
    workflowInputs: createWorkflowInputs({
      resources: input.resources,
      sandboxAdapter,
    }),
  });
}
