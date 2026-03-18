import {
  createDataPlaneDatabase,
  sandboxInstances,
  SandboxInstanceStatuses,
  SandboxInstanceVolumeModes,
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
import { persistSandboxInstanceRuntimeAttachment } from "../openworkflow/resume-sandbox-instance/persist-sandbox-instance-runtime-attachment.js";

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
    "transitions a stopped sandbox instance back to starting and clears stale tunnel state",
    async () => {
      const db = createDatabase();
      const sandboxInstanceId = "sbi_resume_state_integration";

      await db.insert(sandboxInstances).values({
        id: sandboxInstanceId,
        organizationId: "org_resume_state_integration",
        sandboxProfileId: "sbp_resume_state_integration",
        sandboxProfileVersion: 1,
        runtimeProvider: "docker",
        providerRuntimeId: "provider-runtime-old",
        instanceVolumeProvider: "docker",
        instanceVolumeId: "instance-volume-resume-state",
        instanceVolumeMode: SandboxInstanceVolumeModes.NATIVE,
        status: SandboxInstanceStatuses.STOPPED,
        startedByKind: "system",
        startedById: "worker_resume_state_integration",
        source: "dashboard",
        activeTunnelLeaseId: "lease_old",
        tunnelConnectedAt: "2026-03-18T00:00:00.000Z",
        lastTunnelSeenAt: "2026-03-18T00:01:00.000Z",
        tunnelDisconnectedAt: "2026-03-18T00:02:00.000Z",
        stoppedAt: "2026-03-18T00:03:00.000Z",
      });

      await markSandboxInstanceStarting({
        db,
        sandboxInstanceId,
      });

      const startingSandboxInstance = await db.query.sandboxInstances.findFirst({
        columns: {
          status: true,
          providerRuntimeId: true,
          activeTunnelLeaseId: true,
          tunnelConnectedAt: true,
          lastTunnelSeenAt: true,
          tunnelDisconnectedAt: true,
          stoppedAt: true,
          failureCode: true,
          failureMessage: true,
        },
        where: (table, { eq }) => eq(table.id, sandboxInstanceId),
      });

      expect(startingSandboxInstance).toEqual({
        status: SandboxInstanceStatuses.STARTING,
        providerRuntimeId: null,
        activeTunnelLeaseId: null,
        tunnelConnectedAt: null,
        lastTunnelSeenAt: null,
        tunnelDisconnectedAt: null,
        stoppedAt: null,
        failureCode: null,
        failureMessage: null,
      });

      await persistSandboxInstanceRuntimeAttachment(
        {
          db,
        },
        {
          sandboxInstanceId,
          providerRuntimeId: "provider-runtime-new",
        },
      );

      const attachedSandboxInstance = await db.query.sandboxInstances.findFirst({
        columns: {
          providerRuntimeId: true,
          status: true,
        },
        where: (table, { eq }) => eq(table.id, sandboxInstanceId),
      });

      expect(attachedSandboxInstance).toEqual({
        providerRuntimeId: "provider-runtime-new",
        status: SandboxInstanceStatuses.STARTING,
      });
    },
    IntegrationTestTimeoutMs,
  );
});
