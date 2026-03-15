import { createDataPlaneDatabase, sandboxInstances } from "@mistle/db/data-plane";
import {
  DATA_PLANE_MIGRATIONS_FOLDER_PATH,
  MigrationTracking,
  runDataPlaneMigrations,
} from "@mistle/db/migrator";
import { startPostgresWithPgBouncer } from "@mistle/test-harness";
import { systemClock, systemSleeper } from "@mistle/time";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { typeid } from "typeid-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { waitForSandboxTunnelReadiness } from "../src/runtime/services/wait-for-sandbox-tunnel-readiness.js";

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

function getDatabaseStack(): DatabaseStack {
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
      status: "starting",
      startedByKind: "system",
      startedById: "workflow_data_plane_worker_integration",
      source: "webhook",
    });
}

describe("waitForSandboxTunnelReadiness integration", () => {
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
    "does not report readiness when the sandbox tunnel has not connected",
    async () => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow(sandboxInstanceId);

      await expect(
        waitForSandboxTunnelReadiness(
          {
            db: createDatabase(),
            policy: {
              timeoutMs: 150,
              pollIntervalMs: 25,
            },
            clock: systemClock,
            sleeper: systemSleeper,
          },
          {
            sandboxInstanceId,
          },
        ),
      ).resolves.toBe(false);
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "reports readiness after the sandbox tunnel is connected",
    async () => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow(sandboxInstanceId);

      const waitForTunnelReadiness = waitForSandboxTunnelReadiness(
        {
          db: createDatabase(),
          policy: {
            timeoutMs: 1_000,
            pollIntervalMs: 25,
          },
          clock: systemClock,
          sleeper: systemSleeper,
        },
        {
          sandboxInstanceId,
        },
      );

      await systemSleeper.sleep(50);
      await createDatabase()
        .update(sandboxInstances)
        .set({
          activeTunnelLeaseId: "lease_data_plane_worker_integration",
          tunnelConnectedAt: "2026-03-15T00:00:00.000Z",
          lastTunnelSeenAt: "2026-03-15T00:00:00.000Z",
          tunnelDisconnectedAt: null,
        })
        .where(eq(sandboxInstances.id, sandboxInstanceId));

      await expect(waitForTunnelReadiness).resolves.toBe(true);
    },
    IntegrationTestTimeoutMs,
  );
});
