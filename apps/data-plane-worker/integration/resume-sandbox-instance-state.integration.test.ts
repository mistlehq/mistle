import {
  createDataPlaneDatabase,
  sandboxInstances,
  SandboxStopReasons,
  SandboxInstanceStatuses,
} from "@mistle/db/data-plane";
import {
  DATA_PLANE_MIGRATIONS_FOLDER_PATH,
  MigrationTracking,
  runDataPlaneMigrations,
} from "@mistle/db/migrator";
import { startPostgresWithPgBouncer } from "@mistle/test-harness";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { markSandboxInstanceStarting } from "../openworkflow/resume-sandbox-instance/mark-sandbox-instance-starting.js";

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
    await createDatabase().delete(sandboxInstances);
  });

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
