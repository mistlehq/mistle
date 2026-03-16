import { AppIds, loadConfig } from "@mistle/config";
import {
  createDataPlaneDatabase,
  SandboxInstanceSources,
  SandboxInstanceStatuses,
} from "@mistle/db/data-plane";
import type { Clock } from "@mistle/time";
import { systemClock, systemSleeper } from "@mistle/time";
import { StopSandboxInstanceWorkflowSpec } from "@mistle/workflow-registry/data-plane";
import { Client, Pool } from "pg";

import { logger } from "../logger.js";
import { createDataPlaneBackend, createDataPlaneOpenWorkflow } from "../openworkflow/client.js";
import type { DataPlaneWorkerRuntimeConfig } from "../types.js";
import {
  evaluateWebhookSandboxStopReason,
  type WebhookSandboxIdlePolicy,
  type WebhookSandboxStopReason,
  WebhookSandboxStopReasons,
} from "./policy.js";

const ReaperAdvisoryLockKey = 4_246_001;

type ReaperSandboxCandidate = {
  sandboxInstanceId: string;
  startedAt: string;
  latestExecutionLeaseSeenAt: string | null;
  tunnelDisconnectedAt: string | null;
};

export type EligibleWebhookSandboxStop = {
  sandboxInstanceId: string;
  reason: WebhookSandboxStopReason;
};

export type IdleReaperSweepResult = {
  enqueuedStopWorkflowCount: number;
};

function requireLoadedGlobalConfig(
  runtimeConfig: ReturnType<typeof loadConfig<typeof AppIds.DATA_PLANE_WORKER>>,
): asserts runtimeConfig is ReturnType<typeof loadConfig<typeof AppIds.DATA_PLANE_WORKER>> & {
  global: NonNullable<ReturnType<typeof loadConfig<typeof AppIds.DATA_PLANE_WORKER>>["global"]>;
} {
  if (runtimeConfig.global === undefined) {
    throw new Error("Expected global config to be loaded for data-plane-worker reaper.");
  }
}

export function createWebhookIdlePolicy(
  config: DataPlaneWorkerRuntimeConfig,
): WebhookSandboxIdlePolicy {
  return {
    webhookIdleTimeoutMs: config.app.reaper.webhookIdleTimeoutSeconds * 1000,
    executionLeaseFreshnessMs: config.app.reaper.executionLeaseFreshnessSeconds * 1000,
    tunnelDisconnectGraceMs: config.app.reaper.tunnelDisconnectGraceSeconds * 1000,
  };
}

export async function listWebhookSandboxStopCandidates(input: {
  db: ReturnType<typeof createDataPlaneDatabase>;
}): Promise<readonly ReaperSandboxCandidate[]> {
  const sandboxInstances = await input.db.query.sandboxInstances.findMany({
    columns: {
      id: true,
      startedAt: true,
      tunnelDisconnectedAt: true,
    },
    where: (table, { and, eq }) =>
      and(
        eq(table.status, SandboxInstanceStatuses.RUNNING),
        eq(table.source, SandboxInstanceSources.WEBHOOK),
      ),
  });

  return Promise.all(
    sandboxInstances.map(async (sandboxInstance) => {
      if (sandboxInstance.startedAt === null) {
        throw new Error(`Expected startedAt for running webhook sandbox '${sandboxInstance.id}'.`);
      }

      const newestExecutionLease = await input.db.query.sandboxExecutionLeases.findFirst({
        columns: {
          lastSeenAt: true,
        },
        where: (table, { eq }) => eq(table.sandboxInstanceId, sandboxInstance.id),
        orderBy: (table, { desc }) => [desc(table.lastSeenAt)],
      });

      return {
        sandboxInstanceId: sandboxInstance.id,
        startedAt: sandboxInstance.startedAt,
        latestExecutionLeaseSeenAt: newestExecutionLease?.lastSeenAt ?? null,
        tunnelDisconnectedAt: sandboxInstance.tunnelDisconnectedAt,
      } satisfies ReaperSandboxCandidate;
    }),
  );
}

export async function findWebhookSandboxesEligibleForStop(input: {
  db: ReturnType<typeof createDataPlaneDatabase>;
  clock: Clock;
  policy: WebhookSandboxIdlePolicy;
}): Promise<readonly EligibleWebhookSandboxStop[]> {
  const candidates = await listWebhookSandboxStopCandidates({
    db: input.db,
  });

  return candidates.flatMap((candidate) => {
    const reason = evaluateWebhookSandboxStopReason({
      nowMs: input.clock.nowMs(),
      policy: input.policy,
      sandboxInstanceId: candidate.sandboxInstanceId,
      state: {
        startedAt: candidate.startedAt,
        latestExecutionLeaseSeenAt: candidate.latestExecutionLeaseSeenAt,
        tunnelDisconnectedAt: candidate.tunnelDisconnectedAt,
      },
    });

    if (reason === null) {
      return [];
    }

    return [
      {
        sandboxInstanceId: candidate.sandboxInstanceId,
        reason,
      } satisfies EligibleWebhookSandboxStop,
    ];
  });
}

export async function runIdleReaperSweep(input: {
  db: ReturnType<typeof createDataPlaneDatabase>;
  config: DataPlaneWorkerRuntimeConfig;
  clock: Clock;
  enqueueStopWorkflow: (input: { sandboxInstanceId: string }) => Promise<void>;
}): Promise<IdleReaperSweepResult> {
  const policy = createWebhookIdlePolicy(input.config);
  const candidates = await findWebhookSandboxesEligibleForStop({
    db: input.db,
    clock: input.clock,
    policy,
  });

  let enqueuedStopWorkflowCount = 0;
  for (const candidate of candidates) {
    await input.enqueueStopWorkflow({
      sandboxInstanceId: candidate.sandboxInstanceId,
    });
    enqueuedStopWorkflowCount += 1;

    logger.info(
      {
        sandboxInstanceId: candidate.sandboxInstanceId,
        stopReason: candidate.reason,
      },
      candidate.reason === WebhookSandboxStopReasons.DISCONNECTED
        ? "Enqueued sandbox stop workflow after disconnect grace elapsed"
        : "Enqueued idle sandbox stop workflow",
    );
  }

  return {
    enqueuedStopWorkflowCount,
  };
}

async function tryRunSweepWithAdvisoryLock(input: {
  db: ReturnType<typeof createDataPlaneDatabase>;
  databaseUrl: string;
  config: DataPlaneWorkerRuntimeConfig;
  openWorkflow: ReturnType<typeof createDataPlaneOpenWorkflow>;
}): Promise<void> {
  const lockClient = new Client({
    connectionString: input.databaseUrl,
  });
  await lockClient.connect();

  try {
    const lockResult = await lockClient.query<{ acquired: boolean }>(
      "select pg_try_advisory_lock($1) as acquired",
      [ReaperAdvisoryLockKey],
    );
    if (!lockResult.rows[0]?.acquired) {
      return;
    }

    try {
      await runIdleReaperSweep({
        db: input.db,
        config: input.config,
        clock: systemClock,
        enqueueStopWorkflow: async (enqueueInput) => {
          await input.openWorkflow.runWorkflow(
            StopSandboxInstanceWorkflowSpec,
            {
              sandboxInstanceId: enqueueInput.sandboxInstanceId,
            },
            {
              idempotencyKey: `sandbox-stop:${enqueueInput.sandboxInstanceId}`,
            },
          );
        },
      });
    } finally {
      await lockClient.query("select pg_advisory_unlock($1)", [ReaperAdvisoryLockKey]);
    }
  } finally {
    await lockClient.end();
  }
}

export async function runIdleReaper(): Promise<void> {
  const loadedConfig = loadConfig({
    app: AppIds.DATA_PLANE_WORKER,
    env: process.env,
  });
  requireLoadedGlobalConfig(loadedConfig);

  const runtimeConfig: DataPlaneWorkerRuntimeConfig = {
    app: loadedConfig.app,
    sandbox: loadedConfig.global.sandbox,
    telemetry: loadedConfig.global.telemetry,
  };

  const dbPool = new Pool({
    connectionString: loadedConfig.app.database.url,
  });

  let workflowBackend: Awaited<ReturnType<typeof createDataPlaneBackend>> | undefined;

  let shouldStop = false;
  function handleSignal(signal: NodeJS.Signals): void {
    logger.info({ signal }, "Stopping idle reaper");
    shouldStop = true;
  }
  process.on("SIGINT", handleSignal);
  process.on("SIGTERM", handleSignal);

  try {
    const db = createDataPlaneDatabase(dbPool);
    workflowBackend = await createDataPlaneBackend({
      url: loadedConfig.app.workflow.databaseUrl,
      namespaceId: loadedConfig.app.workflow.namespaceId,
      runMigrations: loadedConfig.app.workflow.runMigrations,
    });
    const openWorkflow = createDataPlaneOpenWorkflow({
      backend: workflowBackend,
    });

    logger.info(
      {
        pollIntervalSeconds: runtimeConfig.app.reaper.pollIntervalSeconds,
        webhookIdleTimeoutSeconds: runtimeConfig.app.reaper.webhookIdleTimeoutSeconds,
        executionLeaseFreshnessSeconds: runtimeConfig.app.reaper.executionLeaseFreshnessSeconds,
        tunnelDisconnectGraceSeconds: runtimeConfig.app.reaper.tunnelDisconnectGraceSeconds,
      },
      "Starting idle reaper",
    );

    while (!shouldStop) {
      try {
        await tryRunSweepWithAdvisoryLock({
          db,
          databaseUrl: loadedConfig.app.database.url,
          config: runtimeConfig,
          openWorkflow,
        });
      } catch (error) {
        logger.error({ err: error }, "Idle reaper sweep failed");
      }

      if (shouldStop) {
        break;
      }

      await systemSleeper.sleep(runtimeConfig.app.reaper.pollIntervalSeconds * 1000);
    }
  } finally {
    await dbPool.end();
    await workflowBackend?.stop();
  }
}
