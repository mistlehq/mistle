import {
  createDataPlaneDatabase,
  sandboxExecutionLeases,
  sandboxInstances,
  SandboxInstanceSources,
  SandboxInstanceStatuses,
} from "@mistle/db/data-plane";
import {
  DATA_PLANE_MIGRATIONS_FOLDER_PATH,
  MigrationTracking,
  runDataPlaneMigrations,
} from "@mistle/db/migrator";
import { startPostgresWithPgBouncer } from "@mistle/test-harness";
import { createMutableClock } from "@mistle/time/testing";
import { StopSandboxInstanceWorkflowSpec } from "@mistle/workflow-registry/data-plane";
import { Pool } from "pg";
import { typeid } from "typeid-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  createDataPlaneBackend,
  createDataPlaneOpenWorkflow,
} from "../openworkflow/core/client.js";
import type { DataPlaneWorkerRuntimeConfig } from "../openworkflow/core/config.js";
import { markSandboxInstanceStopped } from "../openworkflow/stop-sandbox-instance/mark-sandbox-instance-stopped.js";
import {
  createSandboxIdlePolicy,
  findSandboxesEligibleForStop,
  runIdleReaperSweep,
} from "../reaper/runtime.js";

const IntegrationTestTimeoutMs = 60_000;

type DatabaseStack = {
  directUrl: string;
  stop: () => Promise<void>;
};

const TestRuntimeConfig: DataPlaneWorkerRuntimeConfig = {
  app: {
    server: {
      host: "127.0.0.1",
      port: 5201,
    },
    database: {
      url: "",
    },
    workflow: {
      databaseUrl: "",
      namespaceId: "integration",
      runMigrations: true,
      concurrency: 1,
    },
    tunnel: {
      bootstrapTokenTtlSeconds: 120,
      exchangeTokenTtlSeconds: 3600,
    },
    reaper: {
      pollIntervalSeconds: 30,
      idleTimeoutSeconds: 300,
      executionLeaseFreshnessSeconds: 30,
      tunnelDisconnectGraceSeconds: 60,
    },
    sandbox: {
      tokenizerProxyEgressBaseUrl: "http://tokenizer-proxy-relay/tokenizer-proxy/egress",
      docker: {
        socketPath: "/var/run/docker.sock",
      },
    },
  },
  sandbox: {
    provider: "docker",
    defaultBaseImage: "localhost:5001/mistle/sandbox-base:test",
    gatewayWsUrl: "ws://127.0.0.1:5202/tunnel/sandbox",
    internalGatewayWsUrl: "ws://127.0.0.1:5202/tunnel/sandbox",
    connect: {
      tokenSecret: "connection-token-secret",
      tokenIssuer: "data-plane-api",
      tokenAudience: "data-plane-gateway",
    },
    bootstrap: {
      tokenSecret: "bootstrap-token-secret",
      tokenIssuer: "data-plane-worker",
      tokenAudience: "data-plane-gateway",
    },
  },
  telemetry: {
    enabled: false,
    debug: false,
  },
};

let databaseStack: DatabaseStack | undefined;
let dbPool: Pool | undefined;
let workflowBackend: Awaited<ReturnType<typeof createDataPlaneBackend>> | undefined;

function getDatabaseStack(): DatabaseStack {
  if (databaseStack === undefined) {
    throw new Error("Expected integration database stack to be initialized.");
  }

  return databaseStack;
}

function getDbPool(): Pool {
  if (dbPool === undefined) {
    throw new Error("Expected integration database pool to be initialized.");
  }

  return dbPool;
}

function getWorkflowBackend(): Awaited<ReturnType<typeof createDataPlaneBackend>> {
  if (workflowBackend === undefined) {
    throw new Error("Expected integration workflow backend to be initialized.");
  }

  return workflowBackend;
}

function createDatabase() {
  return createDataPlaneDatabase(getDbPool());
}

async function insertSandboxInstance(input: {
  sandboxInstanceId: string;
  providerRuntimeId?: string;
  source?: "webhook" | "dashboard";
  status?: "running" | "stopped";
  startedAt?: string;
  tunnelDisconnectedAt?: string | null;
  activeTunnelLeaseId?: string | null;
}): Promise<void> {
  await createDatabase()
    .insert(sandboxInstances)
    .values({
      id: input.sandboxInstanceId,
      organizationId: "org_idle_reaper_integration",
      sandboxProfileId: "sbp_idle_reaper_integration",
      sandboxProfileVersion: 1,
      runtimeProvider: "docker",
      providerRuntimeId: input.providerRuntimeId ?? `provider-${input.sandboxInstanceId}`,
      status: input.status ?? SandboxInstanceStatuses.RUNNING,
      startedByKind: "system",
      startedById: "worker_idle_reaper_integration",
      source: input.source ?? SandboxInstanceSources.WEBHOOK,
      startedAt: input.startedAt ?? "2026-03-16T00:00:00.000Z",
      tunnelDisconnectedAt: input.tunnelDisconnectedAt ?? null,
      activeTunnelLeaseId: input.activeTunnelLeaseId ?? "lease_idle_reaper_integration",
    });
}

async function insertExecutionLease(input: {
  sandboxInstanceId: string;
  lastSeenAt: string;
}): Promise<void> {
  await createDatabase()
    .insert(sandboxExecutionLeases)
    .values({
      id: typeid("sxl").toString(),
      sandboxInstanceId: input.sandboxInstanceId,
      kind: "agent_execution",
      source: "codex",
      externalExecutionId: typeid("turn").toString(),
      metadata: {
        threadId: typeid("thr").toString(),
      },
      openedAt: input.lastSeenAt,
      lastSeenAt: input.lastSeenAt,
    });
}

describe("idle reaper integration", () => {
  beforeAll(async () => {
    databaseStack = await startPostgresWithPgBouncer();
    await runDataPlaneMigrations({
      connectionString: getDatabaseStack().directUrl,
      schemaName: "data_plane",
      migrationsFolder: DATA_PLANE_MIGRATIONS_FOLDER_PATH,
      migrationsSchema: MigrationTracking.DATA_PLANE.SCHEMA_NAME,
      migrationsTable: MigrationTracking.DATA_PLANE.TABLE_NAME,
    });

    dbPool = new Pool({
      connectionString: getDatabaseStack().directUrl,
    });
    workflowBackend = await createDataPlaneBackend({
      url: getDatabaseStack().directUrl,
      namespaceId: "integration",
      runMigrations: true,
    });
  }, IntegrationTestTimeoutMs);

  afterAll(async () => {
    await workflowBackend?.stop();
    await dbPool?.end();
    await databaseStack?.stop();
  });

  beforeEach(async () => {
    await createDatabase().delete(sandboxExecutionLeases);
    await createDatabase().delete(sandboxInstances);
  });

  it(
    "finds running sandboxes of every source that are disconnected or idle beyond the policy thresholds",
    async () => {
      const idleSandboxId = typeid("sbi").toString();
      const dashboardIdleSandboxId = typeid("sbi").toString();
      const freshLeaseSandboxId = typeid("sbi").toString();
      const disconnectedSandboxId = typeid("sbi").toString();
      const stoppedSandboxId = typeid("sbi").toString();
      const recentlyActiveSandboxId = typeid("sbi").toString();

      await insertSandboxInstance({ sandboxInstanceId: idleSandboxId });
      await insertSandboxInstance({
        sandboxInstanceId: dashboardIdleSandboxId,
        source: SandboxInstanceSources.DASHBOARD,
      });
      await insertSandboxInstance({ sandboxInstanceId: freshLeaseSandboxId });
      await insertSandboxInstance({
        sandboxInstanceId: disconnectedSandboxId,
        tunnelDisconnectedAt: "2026-03-16T00:08:30.000Z",
      });
      await insertSandboxInstance({
        sandboxInstanceId: stoppedSandboxId,
        status: SandboxInstanceStatuses.STOPPED,
      });
      await insertSandboxInstance({ sandboxInstanceId: recentlyActiveSandboxId });

      await insertExecutionLease({
        sandboxInstanceId: freshLeaseSandboxId,
        lastSeenAt: "2026-03-16T00:09:45.000Z",
      });
      await insertExecutionLease({
        sandboxInstanceId: recentlyActiveSandboxId,
        lastSeenAt: "2026-03-16T00:08:00.000Z",
      });

      const clock = createMutableClock(Date.parse("2026-03-16T00:10:00.000Z"));

      const candidates = await findSandboxesEligibleForStop({
        db: createDatabase(),
        clock,
        policy: createSandboxIdlePolicy(TestRuntimeConfig),
      });

      expect(candidates).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sandboxInstanceId: idleSandboxId,
            reason: "idle",
          }),
          expect.objectContaining({
            sandboxInstanceId: dashboardIdleSandboxId,
            reason: "idle",
          }),
          expect.objectContaining({
            sandboxInstanceId: disconnectedSandboxId,
            reason: "disconnected",
          }),
        ]),
      );
      expect(
        candidates.some((candidate) => candidate.sandboxInstanceId === freshLeaseSandboxId),
      ).toBe(false);
      expect(candidates.some((candidate) => candidate.sandboxInstanceId === stoppedSandboxId)).toBe(
        false,
      );
      expect(
        candidates.some((candidate) => candidate.sandboxInstanceId === recentlyActiveSandboxId),
      ).toBe(false);
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "enqueues stop workflows for eligible sandboxes across sources",
    async () => {
      const idleSandboxId = typeid("sbi").toString();
      const dashboardIdleSandboxId = typeid("sbi").toString();
      const freshLeaseSandboxId = typeid("sbi").toString();
      const disconnectedSandboxId = typeid("sbi").toString();

      await insertSandboxInstance({ sandboxInstanceId: idleSandboxId });
      await insertSandboxInstance({
        sandboxInstanceId: dashboardIdleSandboxId,
        source: SandboxInstanceSources.DASHBOARD,
      });
      await insertSandboxInstance({ sandboxInstanceId: freshLeaseSandboxId });
      await insertSandboxInstance({
        sandboxInstanceId: disconnectedSandboxId,
        tunnelDisconnectedAt: "2026-03-16T00:08:30.000Z",
      });

      await insertExecutionLease({
        sandboxInstanceId: freshLeaseSandboxId,
        lastSeenAt: "2026-03-16T00:09:45.000Z",
      });

      const openWorkflow = createDataPlaneOpenWorkflow({
        backend: getWorkflowBackend(),
      });
      const sweepResult = await runIdleReaperSweep({
        db: createDatabase(),
        config: TestRuntimeConfig,
        clock: createMutableClock(Date.parse("2026-03-16T00:10:00.000Z")),
        enqueueStopWorkflow: async (input) => {
          await openWorkflow.runWorkflow(
            StopSandboxInstanceWorkflowSpec,
            {
              sandboxInstanceId: input.sandboxInstanceId,
            },
            {
              idempotencyKey: `sandbox-stop:${input.sandboxInstanceId}`,
            },
          );
        },
      });

      expect(sweepResult).toEqual({
        enqueuedStopWorkflowCount: 3,
      });

      const workflowRuns = await getWorkflowBackend().listWorkflowRuns({
        limit: 20,
      });

      expect(
        workflowRuns.data.some(
          (workflowRun) =>
            workflowRun.workflowName === StopSandboxInstanceWorkflowSpec.name &&
            workflowRun.idempotencyKey === `sandbox-stop:${idleSandboxId}` &&
            workflowRun.status === "pending",
        ),
      ).toBe(true);
      expect(
        workflowRuns.data.some(
          (workflowRun) =>
            workflowRun.workflowName === StopSandboxInstanceWorkflowSpec.name &&
            workflowRun.idempotencyKey === `sandbox-stop:${dashboardIdleSandboxId}` &&
            workflowRun.status === "pending",
        ),
      ).toBe(true);
      expect(
        workflowRuns.data.some(
          (workflowRun) =>
            workflowRun.workflowName === StopSandboxInstanceWorkflowSpec.name &&
            workflowRun.idempotencyKey === `sandbox-stop:${disconnectedSandboxId}` &&
            workflowRun.status === "pending",
        ),
      ).toBe(true);
      expect(
        workflowRuns.data.some(
          (workflowRun) =>
            workflowRun.workflowName === StopSandboxInstanceWorkflowSpec.name &&
            workflowRun.idempotencyKey === `sandbox-stop:${freshLeaseSandboxId}`,
        ),
      ).toBe(false);
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "marks a running sandbox instance as stopped and clears the active tunnel lease id",
    async () => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstance({
        sandboxInstanceId,
        activeTunnelLeaseId: "lease_to_clear",
      });

      await markSandboxInstanceStopped({
        db: createDatabase(),
        sandboxInstanceId,
      });

      const persistedSandbox = await createDatabase().query.sandboxInstances.findFirst({
        columns: {
          status: true,
          stoppedAt: true,
          activeTunnelLeaseId: true,
        },
        where: (table, { eq }) => eq(table.id, sandboxInstanceId),
      });

      expect(persistedSandbox).toMatchObject({
        status: SandboxInstanceStatuses.STOPPED,
        activeTunnelLeaseId: null,
      });
      expect(persistedSandbox?.stoppedAt).not.toBeNull();
    },
    IntegrationTestTimeoutMs,
  );
});
