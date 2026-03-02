import { randomUUID } from "node:crypto";

import {
  SandboxInstanceStatuses,
  sandboxInstanceRuntimePlans,
  sandboxInstances,
} from "@mistle/db/data-plane";
import { mintBootstrapToken } from "@mistle/gateway-tunnel-auth";
import { systemSleeper } from "@mistle/time";
import {
  createDataPlaneWorker,
  type DataPlaneWorkerDependencies,
  type StartSandboxInstanceWorkflowInput,
} from "@mistle/workflows/data-plane";
import { and, eq, sql } from "drizzle-orm";

import type { DataPlaneWorkerRuntimeConfig } from "../types.js";
import type { WorkerRuntimeResources } from "./resources.js";
import { encodeSandboxStartupInput } from "./sandbox-startup-input.js";

const SandboxTunnelConnectAckPollIntervalMs = 250;
const SandboxRuntimeTokenizerProxyEgressBaseURLEnv =
  "SANDBOX_RUNTIME_TOKENIZER_PROXY_EGRESS_BASE_URL";

function resolveSandboxTunnelConnectAckTimeoutMs(config: DataPlaneWorkerRuntimeConfig): number {
  const bootstrapTokenTtlSeconds = config.app.tunnel.bootstrapTokenTtlSeconds;

  if (!Number.isFinite(bootstrapTokenTtlSeconds) || bootstrapTokenTtlSeconds <= 0) {
    throw new Error("Expected tunnel bootstrap token TTL seconds to be a positive number.");
  }

  return bootstrapTokenTtlSeconds * 1000;
}

async function waitForSandboxTunnelConnectAck(input: {
  resources: Pick<WorkerRuntimeResources, "db">;
  bootstrapTokenJti: string;
  timeoutMs: number;
}): Promise<boolean> {
  if (input.bootstrapTokenJti.trim().length === 0) {
    throw new Error("Expected bootstrap token JTI to be non-empty when waiting for connect ack.");
  }
  if (input.timeoutMs <= 0) {
    throw new Error("Expected sandbox tunnel connect ack timeout to be positive.");
  }

  const deadlineMs = Date.now() + input.timeoutMs;

  while (true) {
    const ack = await input.resources.db.query.sandboxTunnelConnectAcks.findFirst({
      columns: {
        bootstrapTokenJti: true,
      },
      where: (table, { eq }) => eq(table.bootstrapTokenJti, input.bootstrapTokenJti),
    });
    if (ack !== undefined) {
      return true;
    }

    const remainingMs = deadlineMs - Date.now();
    if (remainingMs <= 0) {
      return false;
    }

    await systemSleeper.sleep(Math.min(remainingMs, SandboxTunnelConnectAckPollIntervalMs));
  }
}

async function writeSandboxStartupInput(input: {
  config: DataPlaneWorkerRuntimeConfig;
  resources: Pick<WorkerRuntimeResources, "sandboxAdapter">;
  runtimePlan: StartSandboxInstanceWorkflowInput["runtimePlan"];
  sandbox: {
    sandboxId: string;
    writeStdin: (input: { payload: Uint8Array<ArrayBufferLike> }) => Promise<void>;
    closeStdin: () => Promise<void>;
  };
}): Promise<string> {
  const bootstrapTokenJti = randomUUID();
  const bootstrapToken = await mintBootstrapToken({
    config: {
      bootstrapTokenSecret: input.config.sandbox.bootstrap.tokenSecret,
      tokenIssuer: input.config.sandbox.bootstrap.tokenIssuer,
      tokenAudience: input.config.sandbox.bootstrap.tokenAudience,
    },
    jti: bootstrapTokenJti,
    ttlSeconds: input.config.app.tunnel.bootstrapTokenTtlSeconds,
  });

  try {
    await input.sandbox.writeStdin({
      payload: encodeSandboxStartupInput({
        bootstrapToken,
        tunnelGatewayWsUrl: input.config.app.tunnel.gatewayWsUrl,
        runtimePlan: input.runtimePlan,
      }),
    });
    await input.sandbox.closeStdin();

    return bootstrapTokenJti;
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

function createWorkerDependencies(ctx: {
  config: DataPlaneWorkerRuntimeConfig;
  resources: Pick<WorkerRuntimeResources, "db" | "sandboxAdapter">;
}): DataPlaneWorkerDependencies {
  const sandboxTunnelConnectAckTimeoutMs = resolveSandboxTunnelConnectAckTimeoutMs(ctx.config);

  return {
    startSandbox: async (workflowInput) => {
      const startedSandbox = await ctx.resources.sandboxAdapter.start({
        image: {
          ...workflowInput.image,
          provider: ctx.config.app.sandbox.provider,
        },
        env: {
          [SandboxRuntimeTokenizerProxyEgressBaseURLEnv]:
            ctx.config.app.sandbox.tokenizerProxyEgressBaseUrl,
        },
      });

      const bootstrapTokenJti = await writeSandboxStartupInput({
        config: ctx.config,
        resources: ctx.resources,
        runtimePlan: workflowInput.runtimePlan,
        sandbox: startedSandbox,
      });

      return {
        provider: startedSandbox.provider,
        providerSandboxId: startedSandbox.sandboxId,
        bootstrapTokenJti,
      };
    },
    stopSandbox: async (workflowInput) => {
      await ctx.resources.sandboxAdapter.stop({
        sandboxId: workflowInput.providerSandboxId,
      });
    },
    insertSandboxInstance: async (workflowInput) => {
      return ctx.resources.db.transaction(async (tx) => {
        const insertedRows = await tx
          .insert(sandboxInstances)
          .values({
            organizationId: workflowInput.organizationId,
            sandboxProfileId: workflowInput.sandboxProfileId,
            sandboxProfileVersion: workflowInput.sandboxProfileVersion,
            provider: workflowInput.provider,
            providerSandboxId: workflowInput.providerSandboxId,
            status: SandboxInstanceStatuses.STARTING,
            startedByKind: workflowInput.startedBy.kind,
            startedById: workflowInput.startedBy.id,
            source: workflowInput.source,
          })
          .returning({
            id: sandboxInstances.id,
          });

        const sandboxInstance = insertedRows[0];
        if (sandboxInstance === undefined) {
          throw new Error("Failed to insert sandbox instance row.");
        }

        await tx.insert(sandboxInstanceRuntimePlans).values({
          sandboxInstanceId: sandboxInstance.id,
          revision: 1,
          compiledRuntimePlan: workflowInput.runtimePlan,
          compiledFromProfileId: workflowInput.sandboxProfileId,
          compiledFromProfileVersion: workflowInput.sandboxProfileVersion,
        });

        return {
          sandboxInstanceId: sandboxInstance.id,
        };
      });
    },
    waitForSandboxTunnelConnectAck: async (workflowInput) => {
      return waitForSandboxTunnelConnectAck({
        resources: ctx.resources,
        bootstrapTokenJti: workflowInput.bootstrapTokenJti,
        timeoutMs: sandboxTunnelConnectAckTimeoutMs,
      });
    },
    updateSandboxInstanceStatus: async (workflowInput) => {
      if (workflowInput.status === "running") {
        const updatedRows = await ctx.resources.db
          .update(sandboxInstances)
          .set({
            status: SandboxInstanceStatuses.RUNNING,
            startedAt: sql`now()`,
            failedAt: null,
            failureCode: null,
            failureMessage: null,
            updatedAt: sql`now()`,
          })
          .where(
            and(
              eq(sandboxInstances.id, workflowInput.sandboxInstanceId),
              eq(sandboxInstances.status, SandboxInstanceStatuses.STARTING),
            ),
          )
          .returning({
            id: sandboxInstances.id,
          });

        if (updatedRows[0] === undefined) {
          throw new Error("Failed to transition sandbox instance status from starting to running.");
        }
        return;
      }

      const updatedRows = await ctx.resources.db
        .update(sandboxInstances)
        .set({
          status: SandboxInstanceStatuses.FAILED,
          failedAt: sql`now()`,
          failureCode: workflowInput.failureCode,
          failureMessage: workflowInput.failureMessage,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(sandboxInstances.id, workflowInput.sandboxInstanceId),
            eq(sandboxInstances.status, SandboxInstanceStatuses.STARTING),
          ),
        )
        .returning({
          id: sandboxInstances.id,
        });

      if (updatedRows[0] === undefined) {
        throw new Error("Failed to transition sandbox instance status from starting to failed.");
      }
    },
  };
}

export function createRuntimeWorker(ctx: {
  config: DataPlaneWorkerRuntimeConfig;
  resources: Pick<WorkerRuntimeResources, "db" | "openWorkflow" | "sandboxAdapter">;
}): ReturnType<typeof createDataPlaneWorker> {
  return createDataPlaneWorker({
    openWorkflow: ctx.resources.openWorkflow,
    maxConcurrentWorkflows: ctx.config.app.workflow.concurrency,
    deps: createWorkerDependencies({
      config: ctx.config,
      resources: ctx.resources,
    }),
  });
}
