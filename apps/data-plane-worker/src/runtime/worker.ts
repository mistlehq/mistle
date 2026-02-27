import { randomUUID } from "node:crypto";

import { SandboxInstanceStatuses, sandboxInstances } from "@mistle/db/data-plane";
import { mintBootstrapToken } from "@mistle/tunnel-auth";
import {
  createDataPlaneWorker,
  type CreateDataPlaneWorkflowDefinitionsInput,
} from "@mistle/workflows/data-plane";
import { sql } from "drizzle-orm";

import type { DataPlaneWorkerRuntimeConfig } from "../types.js";
import type { WorkerRuntimeResources } from "./resources.js";
import { encodeSandboxStartupInput } from "./sandbox-startup-input.js";

async function writeSandboxStartupInput(input: {
  config: DataPlaneWorkerRuntimeConfig;
  resources: Pick<WorkerRuntimeResources, "sandboxAdapter">;
  sandbox: {
    sandboxId: string;
    writeStdin: (input: { payload: Uint8Array<ArrayBufferLike> }) => Promise<void>;
    closeStdin: () => Promise<void>;
  };
}): Promise<void> {
  const bootstrapToken = await mintBootstrapToken({
    config: {
      bootstrapTokenSecret: input.config.tunnel.bootstrapTokenSecret,
      tokenIssuer: input.config.tunnel.tokenIssuer,
      tokenAudience: input.config.tunnel.tokenAudience,
    },
    jti: randomUUID(),
    ttlSeconds: input.config.app.tunnel.bootstrapTokenTtlSeconds,
  });

  try {
    await input.sandbox.writeStdin({
      payload: encodeSandboxStartupInput({
        bootstrapToken,
        tunnelGatewayWsUrl: input.config.app.tunnel.gatewayWsUrl,
      }),
    });
    await input.sandbox.closeStdin();
  } catch (writeError) {
    try {
      await input.resources.sandboxAdapter.stop({
        sandboxId: input.sandbox.sandboxId,
      });
    } catch (stopError) {
      throw new Error(
        "Failed to write sandbox startup input and failed to stop sandbox after startup write failure.",
        {
          cause: {
            writeError,
            stopError,
          },
        },
      );
    }

    throw new Error("Failed to write sandbox startup input to sandbox stdin.", {
      cause: writeError,
    });
  }
}

function createWorkflowInputs(ctx: {
  config: DataPlaneWorkerRuntimeConfig;
  resources: Pick<WorkerRuntimeResources, "db" | "sandboxAdapter">;
}): CreateDataPlaneWorkflowDefinitionsInput {
  return {
    startSandboxInstance: {
      startSandbox: async (workflowInput) => {
        const startedSandbox = await ctx.resources.sandboxAdapter.start({
          image: workflowInput.image,
        });

        await writeSandboxStartupInput({
          config: ctx.config,
          resources: ctx.resources,
          sandbox: startedSandbox,
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
  config: DataPlaneWorkerRuntimeConfig;
  resources: Pick<WorkerRuntimeResources, "db" | "openWorkflow" | "sandboxAdapter">;
}): ReturnType<typeof createDataPlaneWorker> {
  return createDataPlaneWorker({
    openWorkflow: ctx.resources.openWorkflow,
    concurrency: ctx.config.app.workflow.concurrency,
    workflowInputs: createWorkflowInputs({
      config: ctx.config,
      resources: ctx.resources,
    }),
  });
}
