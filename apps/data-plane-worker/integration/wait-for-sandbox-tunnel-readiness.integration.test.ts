import { randomUUID } from "node:crypto";

import {
  createDataPlaneDatabase,
  sandboxInstances,
  sandboxTunnelTokenRedemptions,
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
import { systemClock, systemSleeper } from "@mistle/time";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { typeid } from "typeid-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { waitForSandboxTunnelReadiness } from "../src/runtime/services/wait-for-sandbox-tunnel-readiness.js";

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
    "does not report readiness when only the token redemption row exists",
    async () => {
      const sandboxInstanceId = typeid("sbi").toString();
      const bootstrapTokenJti = randomUUID();
      await insertSandboxInstanceRow(sandboxInstanceId);
      await createDatabase().insert(sandboxTunnelTokenRedemptions).values({
        tokenJti: bootstrapTokenJti,
      });

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
            bootstrapTokenJti,
            sandboxInstanceId,
          },
        ),
      ).resolves.toBe(false);
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "reports readiness after the token redemption row exists and the sandbox tunnel is connected",
    async () => {
      const sandboxInstanceId = typeid("sbi").toString();
      const bootstrapTokenJti = randomUUID();
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
          bootstrapTokenJti,
          sandboxInstanceId,
        },
      );

      await systemSleeper.sleep(50);
      await createDatabase().insert(sandboxTunnelTokenRedemptions).values({
        tokenJti: bootstrapTokenJti,
      });

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
