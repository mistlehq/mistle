import {
  getDataPlaneDatabaseSchema,
  createDataPlaneDatabase,
  sandboxInstanceRuntimePlans,
  sandboxInstances,
  SandboxInstancePersistenceModes,
  SandboxStopReasons,
  SandboxInstanceStatuses,
} from "@mistle/db/data-plane";
import {
  DATA_PLANE_MIGRATIONS_FOLDER_PATH,
  MigrationTracking,
  runDataPlaneMigrations,
} from "@mistle/db/migrator";
import { startPostgresWithPgBouncer } from "@mistle/test-harness";
import type { StartSandboxInstanceWorkflowInput } from "@mistle/workflow-registry/data-plane";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { markSandboxInstanceStarting } from "../openworkflow/resume-sandbox-instance/mark-sandbox-instance-starting.js";
import { resolveResumableSandboxInstanceState } from "../openworkflow/resume-sandbox-instance/resolve-resumable-sandbox-instance-state.js";

const IntegrationTestTimeoutMs = 60_000;

type DatabaseStack = {
  directUrl: string;
  stop: () => Promise<void>;
};

let databaseStack: DatabaseStack | undefined;
let dbPool: Pool | undefined;

function getDbPool(): Pool {
  if (dbPool === undefined) {
    throw new Error("Expected integration database pool to be initialized.");
  }

  return dbPool;
}

function createDatabase() {
  return createDataPlaneDatabase(getDbPool());
}

function createRuntimePlan(input?: {
  sandboxProfileId?: string;
  version?: number;
}): StartSandboxInstanceWorkflowInput["runtimePlan"] {
  return {
    sandboxProfileId: input?.sandboxProfileId ?? "sbp_resume_state_integration",
    version: input?.version ?? 1,
    image: {
      source: "base",
      imageRef: "registry:resume",
    },
    egressRoutes: [],
    artifacts: [],
    runtimeClients: [],
    workspaceSources: [],
    agentRuntimes: [],
  };
}

describe("resume sandbox instance state integration", () => {
  beforeAll(async () => {
    databaseStack = await startPostgresWithPgBouncer();
    await runDataPlaneMigrations({
      connectionString: databaseStack.directUrl,
      schemaName: "data_plane",
      migrationsFolder: DATA_PLANE_MIGRATIONS_FOLDER_PATH,
      migrationsSchema: MigrationTracking.DATA_PLANE.SCHEMA_NAME,
      migrationsTable: MigrationTracking.DATA_PLANE.TABLE_NAME,
    });

    dbPool = new Pool({
      connectionString: databaseStack.directUrl,
    });
  }, IntegrationTestTimeoutMs);

  afterAll(async () => {
    await dbPool?.end();
    await databaseStack?.stop();
  });

  beforeEach(async () => {
    await createDatabase().delete(sandboxInstanceRuntimePlans);
    await createDatabase().delete(sandboxInstances);
  });

  it(
    "resolves the active compiled runtime plan for a resumable sandbox instance",
    async () => {
      const db = createDatabase();
      const sandboxInstanceId = "sbi_resume_state_runtime_plan";

      await db.insert(sandboxInstances).values({
        id: sandboxInstanceId,
        organizationId: "org_resume_state_runtime_plan",
        sandboxProfileId: "sbp_resume_state_runtime_plan",
        sandboxProfileVersion: 2,
        runtimeProvider: "docker",
        providerSandboxId: "provider-runtime-plan",
        status: SandboxInstanceStatuses.STOPPED,
        startedByKind: "system",
        startedById: "worker_resume_state_runtime_plan",
        source: "dashboard",
      });

      await db.insert(sandboxInstanceRuntimePlans).values([
        {
          sandboxInstanceId,
          revision: 1,
          compiledRuntimePlan: createRuntimePlan({
            sandboxProfileId: "sbp_resume_state_runtime_plan",
            version: 1,
          }),
          compiledFromProfileId: "sbp_resume_state_runtime_plan",
          compiledFromProfileVersion: 1,
          supersededAt: "2026-03-18T00:00:00.000Z",
        },
        {
          sandboxInstanceId,
          revision: 2,
          compiledRuntimePlan: createRuntimePlan({
            sandboxProfileId: "sbp_resume_state_runtime_plan",
            version: 2,
          }),
          compiledFromProfileId: "sbp_resume_state_runtime_plan",
          compiledFromProfileVersion: 2,
        },
      ]);

      await expect(
        resolveResumableSandboxInstanceState({
          db,
          tables: getDataPlaneDatabaseSchema(db),
          sandboxInstanceId,
        }),
      ).resolves.toEqual({
        sandboxInstanceId,
        organizationId: "org_resume_state_runtime_plan",
        persistenceMode: SandboxInstancePersistenceModes.EPHEMERAL,
        runtimeProvider: "docker",
        providerSandboxId: "provider-runtime-plan",
        computeGeneration: 1,
        runtimePlan: createRuntimePlan({
          sandboxProfileId: "sbp_resume_state_runtime_plan",
          version: 2,
        }),
      });
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "allows a persistent sandbox instance without provider compute to remain resumable",
    async () => {
      const db = createDatabase();
      const sandboxInstanceId = "sbi_resume_state_missing_provider_persistent";

      await db.insert(sandboxInstances).values({
        id: sandboxInstanceId,
        organizationId: "org_resume_state_missing_provider_persistent",
        sandboxProfileId: "sbp_resume_state_missing_provider_persistent",
        sandboxProfileVersion: 1,
        runtimeProvider: "docker",
        providerSandboxId: null,
        status: SandboxInstanceStatuses.STOPPED,
        persistenceMode: SandboxInstancePersistenceModes.PERSISTENT,
        startedByKind: "system",
        startedById: "worker_resume_state_missing_provider_persistent",
        source: "dashboard",
      });

      await db.insert(sandboxInstanceRuntimePlans).values({
        sandboxInstanceId,
        revision: 1,
        compiledRuntimePlan: createRuntimePlan({
          sandboxProfileId: "sbp_resume_state_missing_provider_persistent",
          version: 1,
        }),
        compiledFromProfileId: "sbp_resume_state_missing_provider_persistent",
        compiledFromProfileVersion: 1,
      });

      await expect(
        resolveResumableSandboxInstanceState({
          db,
          tables: getDataPlaneDatabaseSchema(db),
          sandboxInstanceId,
        }),
      ).resolves.toEqual({
        sandboxInstanceId,
        organizationId: "org_resume_state_missing_provider_persistent",
        persistenceMode: SandboxInstancePersistenceModes.PERSISTENT,
        runtimeProvider: "docker",
        providerSandboxId: null,
        computeGeneration: 1,
        runtimePlan: createRuntimePlan({
          sandboxProfileId: "sbp_resume_state_missing_provider_persistent",
          version: 1,
        }),
      });
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "fails fast when a resumable sandbox instance has no active compiled runtime plan",
    async () => {
      const db = createDatabase();
      const sandboxInstanceId = "sbi_resume_state_missing_runtime_plan";

      await db.insert(sandboxInstances).values({
        id: sandboxInstanceId,
        organizationId: "org_resume_state_missing_runtime_plan",
        sandboxProfileId: "sbp_resume_state_missing_runtime_plan",
        sandboxProfileVersion: 1,
        runtimeProvider: "docker",
        providerSandboxId: "provider-runtime-missing-plan",
        status: SandboxInstanceStatuses.STOPPED,
        startedByKind: "system",
        startedById: "worker_resume_state_missing_runtime_plan",
        source: "dashboard",
      });

      await expect(
        resolveResumableSandboxInstanceState({
          db,
          tables: getDataPlaneDatabaseSchema(db),
          sandboxInstanceId,
        }),
      ).rejects.toThrow(
        `Expected resumable sandbox instance '${sandboxInstanceId}' to have an active compiled runtime plan.`,
      );
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "transitions a stopped sandbox instance back to starting while preserving the provider sandbox id",
    async () => {
      const db = createDatabase();
      const sandboxInstanceId = "sbi_resume_state_integration";

      await db.insert(sandboxInstances).values({
        id: sandboxInstanceId,
        organizationId: "org_resume_state_integration",
        sandboxProfileId: "sbp_resume_state_integration",
        sandboxProfileVersion: 1,
        runtimeProvider: "docker",
        providerSandboxId: "provider-runtime-old",
        status: SandboxInstanceStatuses.STOPPED,
        startedByKind: "system",
        startedById: "worker_resume_state_integration",
        source: "dashboard",
        stoppedAt: "2026-03-18T00:03:00.000Z",
        stopReason: SandboxStopReasons.DISCONNECTED,
      });

      await markSandboxInstanceStarting({
        db,
        tables: getDataPlaneDatabaseSchema(db),
        sandboxInstanceId,
      });

      const startingSandboxInstance = await db.query.sandboxInstances.findFirst({
        columns: {
          status: true,
          providerSandboxId: true,
          stoppedAt: true,
          stopReason: true,
          failureCode: true,
          failureMessage: true,
        },
        where: (table, { eq }) => eq(table.id, sandboxInstanceId),
      });

      expect(startingSandboxInstance).toEqual({
        status: SandboxInstanceStatuses.STARTING,
        providerSandboxId: "provider-runtime-old",
        stoppedAt: null,
        stopReason: null,
        failureCode: null,
        failureMessage: null,
      });
    },
    IntegrationTestTimeoutMs,
  );

  it("transitions a failed sandbox instance back to starting and clears stale failure state", async () => {
    const db = createDatabase();
    const sandboxInstanceId = "sbi_resume_failed_state_integration";

    await db.insert(sandboxInstances).values({
      id: sandboxInstanceId,
      organizationId: "org_resume_failed_state_integration",
      sandboxProfileId: "sbp_resume_failed_state_integration",
      sandboxProfileVersion: 1,
      runtimeProvider: "docker",
      providerSandboxId: "provider-runtime-failed",
      status: SandboxInstanceStatuses.FAILED,
      startedByKind: "system",
      startedById: "worker_resume_failed_state_integration",
      source: "dashboard",
      stopReason: SandboxStopReasons.FAILED,
      failedAt: "2026-03-18T00:03:00.000Z",
      failureCode: "resume_failed_state",
      failureMessage: "Sandbox failed before retry.",
    });

    await markSandboxInstanceStarting({
      db,
      tables: getDataPlaneDatabaseSchema(db),
      sandboxInstanceId,
    });

    const startingSandboxInstance = await db.query.sandboxInstances.findFirst({
      columns: {
        status: true,
        providerSandboxId: true,
        stoppedAt: true,
        stopReason: true,
        failedAt: true,
        failureCode: true,
        failureMessage: true,
      },
      where: (table, { eq }) => eq(table.id, sandboxInstanceId),
    });

    expect(startingSandboxInstance).toEqual({
      status: SandboxInstanceStatuses.STARTING,
      providerSandboxId: "provider-runtime-failed",
      stoppedAt: null,
      stopReason: null,
      failedAt: null,
      failureCode: null,
      failureMessage: null,
    });
  });
});
