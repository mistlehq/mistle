import {
  createDataPlaneDatabase,
  sandboxExecutionLeases,
  sandboxInstances,
} from "@mistle/db/data-plane";
import {
  DATA_PLANE_MIGRATIONS_FOLDER_PATH,
  MigrationTracking,
  runDataPlaneMigrations,
} from "@mistle/db/migrator";
import {
  startPostgresWithPgBouncer,
  type PostgresWithPgBouncerService,
} from "@mistle/test-harness";
import { Pool } from "pg";
import { typeid } from "typeid-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readSandboxExecutionLeaseState } from "../src/runtime/services/read-sandbox-execution-lease-state.js";

const IntegrationTestTimeoutMs = 60_000;

let databaseStack: PostgresWithPgBouncerService | undefined;
let dbPool: Pool | undefined;

function getDbPool(): Pool {
  if (dbPool === undefined) {
    throw new Error("Expected integration database pool to be initialized.");
  }

  return dbPool;
}

function getDatabaseStack(): PostgresWithPgBouncerService {
  if (databaseStack === undefined) {
    throw new Error("Expected integration database stack to be initialized.");
  }

  return databaseStack;
}

function createDatabase() {
  return createDataPlaneDatabase(getDbPool());
}

async function insertSandboxInstanceRow(sandboxInstanceId: string): Promise<void> {
  await createDatabase()
    .insert(sandboxInstances)
    .values({
      id: sandboxInstanceId,
      organizationId: "org_data_plane_worker_integration",
      sandboxProfileId: "sbp_data_plane_worker_integration",
      sandboxProfileVersion: 1,
      provider: "docker",
      providerSandboxId: `provider-${sandboxInstanceId}`,
      status: "running",
      startedByKind: "system",
      startedById: "workflow_data_plane_worker_integration",
      source: "webhook",
    });
}

describe("readSandboxExecutionLeaseState integration", () => {
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
  }, IntegrationTestTimeoutMs);

  afterAll(async () => {
    await dbPool?.end();
    await databaseStack?.stop();
  });

  it(
    "returns no fresh lease state when the sandbox has no execution leases",
    async () => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow(sandboxInstanceId);

      await expect(
        readSandboxExecutionLeaseState(
          {
            db: createDatabase(),
          },
          {
            sandboxInstanceId,
            freshSince: "2026-03-16T00:00:00.000Z",
          },
        ),
      ).resolves.toEqual({
        newestLastSeenAt: null,
        hasFreshExecutionLease: false,
      });
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "returns the newest lease timestamp and freshness for the requested sandbox only",
    async () => {
      const sandboxInstanceId = typeid("sbi").toString();
      const differentSandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow(sandboxInstanceId);
      await insertSandboxInstanceRow(differentSandboxInstanceId);

      await createDatabase()
        .insert(sandboxExecutionLeases)
        .values([
          {
            id: typeid("sxl").toString(),
            sandboxInstanceId,
            kind: "agent_execution",
            source: "codex",
            externalExecutionId: "turn-stale",
            openedAt: "2026-03-16T00:00:00.000Z",
            lastSeenAt: "2026-03-16T00:02:00.000Z",
          },
          {
            id: typeid("sxl").toString(),
            sandboxInstanceId,
            kind: "agent_execution",
            source: "codex",
            externalExecutionId: "turn-fresh",
            openedAt: "2026-03-16T00:03:00.000Z",
            lastSeenAt: "2026-03-16T00:05:00.000Z",
          },
          {
            id: typeid("sxl").toString(),
            sandboxInstanceId: differentSandboxInstanceId,
            kind: "agent_execution",
            source: "codex",
            externalExecutionId: "turn-other-sandbox",
            openedAt: "2026-03-16T00:04:00.000Z",
            lastSeenAt: "2026-03-16T00:10:00.000Z",
          },
        ]);

      await expect(
        readSandboxExecutionLeaseState(
          {
            db: createDatabase(),
          },
          {
            sandboxInstanceId,
            freshSince: "2026-03-16T00:04:00.000Z",
          },
        ),
      ).resolves.toEqual({
        newestLastSeenAt: "2026-03-16T00:05:00.000Z",
        hasFreshExecutionLease: true,
      });
    },
    IntegrationTestTimeoutMs,
  );
});
