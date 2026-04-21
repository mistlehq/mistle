import { randomUUID } from "node:crypto";

import { Archil } from "@archildata/client/api";
import { ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import {
  createControlPlaneDatabase,
  organizationCredentialKeys,
  organizationSandboxStorageSettings,
  organizations,
  SandboxStorageConfigSources,
} from "@mistle/db/control-plane";
import {
  createDataPlaneDatabase,
  sandboxInstanceStorages,
  sandboxInstances,
  SandboxInstancePersistenceModes,
} from "@mistle/db/data-plane";
import {
  CONTROL_PLANE_MIGRATIONS_FOLDER_PATH,
  DATA_PLANE_MIGRATIONS_FOLDER_PATH,
  MigrationTracking,
  runControlPlaneMigrations,
  runDataPlaneMigrations,
} from "@mistle/db/migrator";
import { SandboxProvider, SandboxStorageBackend } from "@mistle/sandbox";
import { reserveAvailablePort, startPostgresWithPgBouncer } from "@mistle/test-harness";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { ensureCommitSignBinaryInstalled } from "../../control-plane-api/integration/helpers/commit-sign.js";
import type { DataPlaneWorkerConfig } from "../openworkflow/core/config.js";
import { createSandboxStorageBackendAdapter } from "../openworkflow/shared/sandbox-storage/create-sandbox-storage-backend-adapter.js";
import { getSandboxInstanceStorageBySandboxInstanceId } from "../openworkflow/shared/sandbox-storage/storage-persistence.js";
import { ensureSandboxInstance } from "../openworkflow/start-sandbox-instance/ensure-sandbox-instance.js";
import { startControlPlaneApiProcess } from "./helpers/control-plane-api.js";
import { insertInitialOrganizationCredentialKey } from "./helpers/organization-credential-keys.js";

const IntegrationTestTimeoutMs = 120_000;
const InternalAuthServiceToken = "integration-service-token";
const MasterEncryptionKeyVersion = 1;
const OrganizationCredentialKeyVersion = 1;
const MasterEncryptionKeys = {
  "1": "integration-master-key-testing",
} as const;
const TestArchilRegion = "gcp-us-central1";

const ArchilIntegrationEnvironmentSchema = z
  .object({
    MISTLE_TEST_ARCHIL_API_KEY: z.string().min(1),
    MISTLE_TEST_ARCHIL_S3_BUCKET: z.string().min(1),
    MISTLE_TEST_ARCHIL_S3_ENDPOINT: z.url(),
    MISTLE_TEST_ARCHIL_S3_ACCESS_KEY_ID: z.string().min(1),
    MISTLE_TEST_ARCHIL_S3_SECRET_ACCESS_KEY: z.string().min(1),
  })
  .strict();

type DatabaseStack = {
  directUrl: string;
  stop: () => Promise<void>;
};

type ArchilIntegrationEnvironment = z.infer<typeof ArchilIntegrationEnvironmentSchema>;

function readArchilIntegrationEnvironment(): ArchilIntegrationEnvironment | null {
  const parsed = ArchilIntegrationEnvironmentSchema.safeParse({
    MISTLE_TEST_ARCHIL_API_KEY: process.env.MISTLE_TEST_ARCHIL_API_KEY,
    MISTLE_TEST_ARCHIL_S3_BUCKET: process.env.MISTLE_TEST_ARCHIL_S3_BUCKET,
    MISTLE_TEST_ARCHIL_S3_ENDPOINT: process.env.MISTLE_TEST_ARCHIL_S3_ENDPOINT,
    MISTLE_TEST_ARCHIL_S3_ACCESS_KEY_ID: process.env.MISTLE_TEST_ARCHIL_S3_ACCESS_KEY_ID,
    MISTLE_TEST_ARCHIL_S3_SECRET_ACCESS_KEY: process.env.MISTLE_TEST_ARCHIL_S3_SECRET_ACCESS_KEY,
  });

  if (!parsed.success) {
    return null;
  }

  return parsed.data;
}

const archilIntegrationEnvironment = readArchilIntegrationEnvironment();
const describeIfArchilIntegration =
  archilIntegrationEnvironment === null ? describe.skip : describe;

function createWorkerConfig(input: ArchilIntegrationEnvironment): DataPlaneWorkerConfig {
  return {
    database: {
      url: "postgresql://unused",
    },
    workflow: {
      databaseUrl: "postgresql://unused",
      namespaceId: "integration",
      runMigrations: false,
      concurrency: 1,
    },
    tunnel: {
      bootstrapTokenTtlSeconds: 120,
      exchangeTokenTtlSeconds: 3600,
    },
    runtimeState: {
      gatewayBaseUrl: "http://127.0.0.1:5202",
    },
    controlPlaneApi: {
      baseUrl: "http://127.0.0.1:5100",
    },
    sandbox: {
      tokenizerProxyEgressBaseUrl: "http://tokenizer-proxy/tokenizer-proxy/egress",
    },
    sandboxStorage: {
      archil: {
        apiKey: input.MISTLE_TEST_ARCHIL_API_KEY,
        region: TestArchilRegion,
        namePrefix: "it-pr9-",
        mounts: [
          {
            type: "s3-compatible" as const,
            bucket: input.MISTLE_TEST_ARCHIL_S3_BUCKET,
            endpoint: input.MISTLE_TEST_ARCHIL_S3_ENDPOINT,
            accessKeyId: input.MISTLE_TEST_ARCHIL_S3_ACCESS_KEY_ID,
            secretAccessKey: input.MISTLE_TEST_ARCHIL_S3_SECRET_ACCESS_KEY,
          },
        ],
      },
    },
  };
}

function createArchilStorageBackendAdapter(input: {
  db: ReturnType<typeof createDataPlaneDatabase>;
  controlPlaneInternalClient: ControlPlaneInternalClient;
  workerConfig: DataPlaneWorkerConfig;
}) {
  return createSandboxStorageBackendAdapter({
    db: input.db,
    controlPlaneInternalClient: input.controlPlaneInternalClient,
    workerConfig: input.workerConfig,
    runtimeProvider: SandboxProvider.E2B,
    storageBackend: SandboxStorageBackend.ARCHIL,
  });
}

describeIfArchilIntegration("deprovisionSandboxStorage integration", () => {
  let databaseStack: DatabaseStack | undefined;
  let dbPool: Pool | undefined;
  let controlPlaneApi: Awaited<ReturnType<typeof startControlPlaneApiProcess>> | undefined;
  const createdDiskIds = new Set<string>();

  const archilEnvironment = archilIntegrationEnvironment;

  if (archilEnvironment === null) {
    return;
  }

  const archil = new Archil({
    apiKey: archilEnvironment.MISTLE_TEST_ARCHIL_API_KEY,
    region: TestArchilRegion,
  });

  function createControlPlaneDb() {
    if (dbPool === undefined) {
      throw new Error("Expected integration database pool to be initialized.");
    }

    return createControlPlaneDatabase(dbPool);
  }

  function createDataPlaneDb() {
    if (dbPool === undefined) {
      throw new Error("Expected integration database pool to be initialized.");
    }

    return createDataPlaneDatabase(dbPool);
  }

  beforeAll(async () => {
    await ensureCommitSignBinaryInstalled();
    databaseStack = await startPostgresWithPgBouncer();

    await runControlPlaneMigrations({
      connectionString: databaseStack.directUrl,
      schemaName: "control_plane",
      migrationsFolder: CONTROL_PLANE_MIGRATIONS_FOLDER_PATH,
      migrationsSchema: MigrationTracking.CONTROL_PLANE.SCHEMA_NAME,
      migrationsTable: MigrationTracking.CONTROL_PLANE.TABLE_NAME,
    });

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

    const controlPlanePort = await reserveAvailablePort({ host: "127.0.0.1" });
    controlPlaneApi = await startControlPlaneApiProcess({
      host: "127.0.0.1",
      port: controlPlanePort,
      databaseUrl: databaseStack.directUrl,
      dataPlaneApiBaseUrl: "http://127.0.0.1:5201",
      workflowNamespaceId: "integration",
      internalAuthServiceToken: InternalAuthServiceToken,
      sandboxStorageBackend: SandboxStorageBackend.ARCHIL,
    });
  }, IntegrationTestTimeoutMs);

  afterAll(async () => {
    for (const diskId of createdDiskIds) {
      const disk = await archil.disks.get(diskId).catch(() => undefined);
      await disk?.delete().catch(() => undefined);
    }
    createdDiskIds.clear();

    await controlPlaneApi?.stop();
    await dbPool?.end();
    await databaseStack?.stop();
  });

  beforeEach(async () => {
    for (const diskId of createdDiskIds) {
      const disk = await archil.disks.get(diskId).catch(() => undefined);
      await disk?.delete().catch(() => undefined);
    }
    createdDiskIds.clear();

    await createDataPlaneDb().delete(sandboxInstanceStorages);
    await createDataPlaneDb().delete(sandboxInstances);
    await createControlPlaneDb().delete(organizationSandboxStorageSettings);
    await createControlPlaneDb().delete(organizationCredentialKeys);
    await createControlPlaneDb().delete(organizations);
  });

  it(
    "deletes the Archil disk and removes the storage row",
    async () => {
      if (controlPlaneApi === undefined) {
        throw new Error("Expected control-plane API process to be initialized.");
      }

      const controlPlaneInternalClient = new ControlPlaneInternalClient({
        baseUrl: controlPlaneApi.baseUrl,
        internalAuthServiceToken: InternalAuthServiceToken,
      });
      const organizationId = `org_pr9_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
      const sandboxInstanceId = `sbi_pr9_${randomUUID().replaceAll("-", "").slice(0, 12)}`;

      await createControlPlaneDb()
        .insert(organizations)
        .values({
          id: organizationId,
          slug: `org-pr9-${randomUUID().replaceAll("-", "").slice(0, 12)}`,
          name: "PR9 integration organization",
        });
      await insertInitialOrganizationCredentialKey({
        db: createControlPlaneDb(),
        organizationId,
        organizationCredentialKeyVersion: OrganizationCredentialKeyVersion,
        masterEncryptionKeyVersion: MasterEncryptionKeyVersion,
        masterEncryptionKeys: MasterEncryptionKeys,
      });
      await createControlPlaneDb().insert(organizationSandboxStorageSettings).values({
        organizationId,
        persistentSandboxesEnabled: true,
        storageConfigSource: SandboxStorageConfigSources.MANAGED,
      });

      await ensureSandboxInstance(
        {
          db: createDataPlaneDb(),
          runtimeProvider: "e2b",
        },
        {
          sandboxInstanceId,
          organizationId,
          sandboxProfileId: "sbp_pr9_integration",
          sandboxProfileVersion: 1,
          persistenceMode: SandboxInstancePersistenceModes.PERSISTENT,
          startedBy: {
            kind: "system",
            id: "worker_pr9_integration",
          },
          source: "dashboard",
        },
      );

      const storageBackendAdapter = createArchilStorageBackendAdapter({
        db: createDataPlaneDb(),
        controlPlaneInternalClient,
        workerConfig: createWorkerConfig(archilEnvironment),
      });

      const provisionedStorage = await storageBackendAdapter.provision({
        organizationId,
        sandboxInstanceId,
      });
      createdDiskIds.add(provisionedStorage.handle);

      expect(await archil.disks.get(provisionedStorage.handle)).toBeDefined();

      await storageBackendAdapter.deprovision({
        organizationId,
        sandboxInstanceId,
      });

      await expect(archil.disks.get(provisionedStorage.handle)).rejects.toThrow();
      createdDiskIds.delete(provisionedStorage.handle);
      await expect(
        getSandboxInstanceStorageBySandboxInstanceId(
          {
            db: createDataPlaneDb(),
          },
          {
            sandboxInstanceId,
          },
        ),
      ).resolves.toBeUndefined();
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "still removes the storage row when disk deletion fails because the disk is already missing",
    async () => {
      if (controlPlaneApi === undefined) {
        throw new Error("Expected control-plane API process to be initialized.");
      }

      const controlPlaneInternalClient = new ControlPlaneInternalClient({
        baseUrl: controlPlaneApi.baseUrl,
        internalAuthServiceToken: InternalAuthServiceToken,
      });
      const organizationId = `org_pr9_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
      const sandboxInstanceId = `sbi_pr9_${randomUUID().replaceAll("-", "").slice(0, 12)}`;

      await createControlPlaneDb()
        .insert(organizations)
        .values({
          id: organizationId,
          slug: `org-pr9-${randomUUID().replaceAll("-", "").slice(0, 12)}`,
          name: "PR9 integration organization",
        });
      await insertInitialOrganizationCredentialKey({
        db: createControlPlaneDb(),
        organizationId,
        organizationCredentialKeyVersion: OrganizationCredentialKeyVersion,
        masterEncryptionKeyVersion: MasterEncryptionKeyVersion,
        masterEncryptionKeys: MasterEncryptionKeys,
      });
      await createControlPlaneDb().insert(organizationSandboxStorageSettings).values({
        organizationId,
        persistentSandboxesEnabled: true,
        storageConfigSource: SandboxStorageConfigSources.MANAGED,
      });

      await ensureSandboxInstance(
        {
          db: createDataPlaneDb(),
          runtimeProvider: "e2b",
        },
        {
          sandboxInstanceId,
          organizationId,
          sandboxProfileId: "sbp_pr9_integration",
          sandboxProfileVersion: 1,
          persistenceMode: SandboxInstancePersistenceModes.PERSISTENT,
          startedBy: {
            kind: "system",
            id: "worker_pr9_integration",
          },
          source: "dashboard",
        },
      );

      const storageBackendAdapter = createArchilStorageBackendAdapter({
        db: createDataPlaneDb(),
        controlPlaneInternalClient,
        workerConfig: createWorkerConfig(archilEnvironment),
      });

      const provisionedStorage = await storageBackendAdapter.provision({
        organizationId,
        sandboxInstanceId,
      });
      createdDiskIds.add(provisionedStorage.handle);

      const disk = await archil.disks.get(provisionedStorage.handle);
      await disk.delete();
      createdDiskIds.delete(provisionedStorage.handle);

      await expect(
        storageBackendAdapter.deprovision({
          organizationId,
          sandboxInstanceId,
        }),
      ).rejects.toThrow(
        `Failed to delete Archil sandbox storage disk for sandbox instance '${sandboxInstanceId}'.`,
      );

      await expect(
        getSandboxInstanceStorageBySandboxInstanceId(
          {
            db: createDataPlaneDb(),
          },
          {
            sandboxInstanceId,
          },
        ),
      ).resolves.toBeUndefined();
    },
    IntegrationTestTimeoutMs,
  );
});
