import {
  createDataPlaneDatabase,
  SandboxInstancePersistenceModes,
  sandboxInstanceRuntimePlans,
  sandboxInstanceStorages,
  sandboxInstances,
  SandboxInstanceStatuses,
  SandboxStorageCredentialKinds,
  SandboxStorageProviders,
  SandboxStorageStatuses,
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
import {
  getSandboxInstanceStorageBySandboxInstanceId,
  insertSandboxInstanceStorage,
  updateSandboxInstanceStorageCredential,
} from "../openworkflow/start-sandbox-instance/provision-sandbox-storage.js";

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
    await createDatabase().delete(sandboxInstanceStorages);
    await createDatabase().delete(sandboxInstances);
  });

  it(
    "persists provider sandbox metadata",
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
          persistenceMode: SandboxInstancePersistenceModes.EPHEMERAL,
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
          persistenceMode: true,
          status: true,
        },
        where: (table, { eq }) => eq(table.id, sandboxInstanceId),
      });

      expect(persistedStartingInstance).toEqual({
        id: sandboxInstanceId,
        persistenceMode: SandboxInstancePersistenceModes.EPHEMERAL,
        status: SandboxInstanceStatuses.PENDING,
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
          status: true,
          providerSandboxId: true,
        },
        where: (table, { eq }) => eq(table.id, sandboxInstanceId),
      });

      expect(persistedProvisionedInstance).toEqual({
        id: sandboxInstanceId,
        status: SandboxInstanceStatuses.STARTING,
        providerSandboxId: "provider-runtime-start-provisioning",
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

  it(
    "persists and updates sandbox storage metadata",
    async () => {
      const db = createDatabase();
      const sandboxInstanceId = "sbi_start_storage_provisioning_integration";

      await ensureSandboxInstance(
        {
          db,
          runtimeProvider: "docker",
        },
        {
          sandboxInstanceId,
          organizationId: "org_start_storage_provisioning_integration",
          sandboxProfileId: "sbp_start_storage_provisioning_integration",
          sandboxProfileVersion: 1,
          persistenceMode: SandboxInstancePersistenceModes.PERSISTENT,
          startedBy: {
            kind: "system",
            id: "worker_start_storage_provisioning_integration",
          },
          source: "dashboard",
        },
      );

      await insertSandboxInstanceStorage(
        {
          db,
        },
        {
          sandboxInstanceId,
          provider: SandboxStorageProviders.ARCHIL,
          handle: "dsk-0123456789abcdef",
          region: "aws-us-east-1",
          status: SandboxStorageStatuses.READY,
          credentialCiphertext: "ciphertext-v1",
          credentialNonce: "nonce-v1",
          credentialKind: SandboxStorageCredentialKinds.DISK_TOKEN,
          organizationCredentialKeyVersion: 1,
        },
      );

      const insertedStorage = await getSandboxInstanceStorageBySandboxInstanceId(
        {
          db,
        },
        {
          sandboxInstanceId,
        },
      );

      expect(insertedStorage).toMatchObject({
        sandboxInstanceId,
        provider: SandboxStorageProviders.ARCHIL,
        handle: "dsk-0123456789abcdef",
        region: "aws-us-east-1",
        status: SandboxStorageStatuses.READY,
        credentialCiphertext: "ciphertext-v1",
        credentialNonce: "nonce-v1",
        credentialKind: SandboxStorageCredentialKinds.DISK_TOKEN,
        organizationCredentialKeyVersion: 1,
      });

      await updateSandboxInstanceStorageCredential(
        {
          db,
        },
        {
          sandboxInstanceId,
          status: SandboxStorageStatuses.FAILED,
          credentialCiphertext: "ciphertext-v2",
          credentialNonce: "nonce-v2",
          credentialKind: SandboxStorageCredentialKinds.DISK_TOKEN,
          organizationCredentialKeyVersion: 2,
        },
      );

      const updatedStorage = await getSandboxInstanceStorageBySandboxInstanceId(
        {
          db,
        },
        {
          sandboxInstanceId,
        },
      );

      expect(updatedStorage).toMatchObject({
        sandboxInstanceId,
        provider: SandboxStorageProviders.ARCHIL,
        handle: "dsk-0123456789abcdef",
        region: "aws-us-east-1",
        status: SandboxStorageStatuses.FAILED,
        credentialCiphertext: "ciphertext-v2",
        credentialNonce: "nonce-v2",
        credentialKind: SandboxStorageCredentialKinds.DISK_TOKEN,
        organizationCredentialKeyVersion: 2,
      });
    },
    IntegrationTestTimeoutMs,
  );
});
