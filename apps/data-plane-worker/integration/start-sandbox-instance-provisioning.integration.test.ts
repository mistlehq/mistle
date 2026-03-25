import {
  createDataPlaneDatabase,
  sandboxInstanceRuntimePlans,
  sandboxInstances,
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

import { ensureSandboxInstance } from "../openworkflow/start-sandbox-instance/ensure-sandbox-instance.js";
import { persistSandboxInstanceProvisioning } from "../openworkflow/start-sandbox-instance/persist-sandbox-instance-provisioning.js";

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

function createRuntimePlan(): StartSandboxInstanceWorkflowInput["runtimePlan"] {
  return {
    sandboxProfileId: "sbp_start_provisioning_integration",
    version: 1,
    image: {
      source: "base",
      imageRef: "registry:1",
    },
    egressRoutes: [],
    artifacts: [],
    runtimeClients: [],
    workspaceSources: [],
    agentRuntimes: [],
  };
}

describe("start sandbox instance provisioning integration", () => {
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
    "persists provider sandbox metadata without writing instance volume metadata",
    async () => {
      const db = createDatabase();
      const sandboxInstanceId = "sbi_start_provisioning_integration";

      await ensureSandboxInstance(
        {
          db,
          runtimeProvider: "docker",
        },
        {
          sandboxInstanceId,
          organizationId: "org_start_provisioning_integration",
          sandboxProfileId: "sbp_start_provisioning_integration",
          sandboxProfileVersion: 3,
          startedBy: {
            kind: "system",
            id: "worker_start_provisioning_integration",
          },
          source: "dashboard",
        },
      );

      const persistedStartingInstance = await db.query.sandboxInstances.findFirst({
        columns: {
          id: true,
          status: true,
          instanceVolumeProvider: true,
          instanceVolumeId: true,
          instanceVolumeMode: true,
        },
        where: (table, { eq }) => eq(table.id, sandboxInstanceId),
      });

      expect(persistedStartingInstance).toEqual({
        id: sandboxInstanceId,
        status: SandboxInstanceStatuses.STARTING,
        instanceVolumeProvider: null,
        instanceVolumeId: null,
        instanceVolumeMode: null,
      });

      await persistSandboxInstanceProvisioning(
        {
          db,
        },
        {
          sandboxInstanceId,
          runtimePlan: createRuntimePlan(),
          sandboxProfileId: "sbp_start_provisioning_integration",
          sandboxProfileVersion: 3,
          providerSandboxId: "provider-runtime-start-provisioning",
        },
      );

      const persistedProvisionedInstance = await db.query.sandboxInstances.findFirst({
        columns: {
          id: true,
          providerSandboxId: true,
          instanceVolumeProvider: true,
          instanceVolumeId: true,
          instanceVolumeMode: true,
        },
        where: (table, { eq }) => eq(table.id, sandboxInstanceId),
      });

      expect(persistedProvisionedInstance).toEqual({
        id: sandboxInstanceId,
        providerSandboxId: "provider-runtime-start-provisioning",
        instanceVolumeProvider: null,
        instanceVolumeId: null,
        instanceVolumeMode: null,
      });

      const persistedRuntimePlans = await db.query.sandboxInstanceRuntimePlans.findMany({
        columns: {
          sandboxInstanceId: true,
          revision: true,
          compiledFromProfileId: true,
          compiledFromProfileVersion: true,
        },
        where: (table, { eq }) => eq(table.sandboxInstanceId, sandboxInstanceId),
      });

      expect(persistedRuntimePlans).toEqual([
        {
          sandboxInstanceId,
          revision: 1,
          compiledFromProfileId: "sbp_start_provisioning_integration",
          compiledFromProfileVersion: 3,
        },
      ]);
    },
    IntegrationTestTimeoutMs,
  );
});
