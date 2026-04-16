import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import { ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import {
  createDataPlaneDatabase,
  sandboxInstanceStorages,
  sandboxInstances,
  SandboxInstancePersistenceModes,
  SandboxStorageProviders,
  SandboxStorageStatuses,
} from "@mistle/db/data-plane";
import {
  DATA_PLANE_MIGRATIONS_FOLDER_PATH,
  MigrationTracking,
  runDataPlaneMigrations,
} from "@mistle/db/migrator";
import { SandboxProvider, SandboxStorageBackend } from "@mistle/sandbox";
import { startPostgresWithPgBouncer } from "@mistle/test-harness";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { DataPlaneWorkerConfig } from "../openworkflow/core/config.js";
import { createSandboxStorageBackendAdapter } from "../openworkflow/shared/sandbox-storage/create-sandbox-storage-backend-adapter.js";
import { ensureSandboxInstance } from "../openworkflow/start-sandbox-instance/ensure-sandbox-instance.js";

const IntegrationTestTimeoutMs = 120_000;
const DockerSocketPath = "/var/run/docker.sock";

type DatabaseStack = {
  directUrl: string;
  stop: () => Promise<void>;
};

function hasDockerVolumeIntegrationRuntime(): boolean {
  if (!existsSync(DockerSocketPath)) {
    return false;
  }

  try {
    execFileSync("docker", ["version", "--format", "{{.Server.Version}}"], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function volumeExists(volumeName: string): boolean {
  try {
    execFileSync("docker", ["volume", "inspect", volumeName], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function deleteVolume(volumeName: string): void {
  try {
    execFileSync("docker", ["volume", "rm", volumeName], {
      stdio: "ignore",
    });
  } catch {}
}

function createWorkerConfig(): DataPlaneWorkerConfig {
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
      docker: {
        socketPath: DockerSocketPath,
      },
    },
    sandboxStorage: {
      dockerVolume: {
        namePrefix: "it-pr12-",
      },
    },
  };
}

function createDockerVolumeStorageBackendAdapter(input: {
  db: ReturnType<typeof createDataPlaneDatabase>;
}) {
  return createSandboxStorageBackendAdapter({
    db: input.db,
    controlPlaneInternalClient: new ControlPlaneInternalClient({
      baseUrl: "http://127.0.0.1:1",
      internalAuthServiceToken: "unused",
    }),
    workerConfig: createWorkerConfig(),
    runtimeProvider: SandboxProvider.DOCKER,
    storageBackend: SandboxStorageBackend.DOCKER_VOLUME,
  });
}

const describeIfDockerVolumeIntegration = hasDockerVolumeIntegrationRuntime()
  ? describe
  : describe.skip;

describeIfDockerVolumeIntegration("docker volume sandbox storage integration", () => {
  let databaseStack: DatabaseStack | undefined;
  let dbPool: Pool | undefined;
  const createdVolumeNames = new Set<string>();

  function createDataPlaneDb() {
    if (dbPool === undefined) {
      throw new Error("Expected database pool to be initialized.");
    }

    return createDataPlaneDatabase(dbPool);
  }

  beforeAll(async () => {
    const postgresStack = await startPostgresWithPgBouncer();
    databaseStack = {
      directUrl: postgresStack.directUrl,
      stop: async () => {
        await postgresStack.stop();
      },
    };

    await runDataPlaneMigrations({
      connectionString: databaseStack.directUrl,
      migrationsFolder: DATA_PLANE_MIGRATIONS_FOLDER_PATH,
      schemaName: "data_plane",
      migrationsSchema: MigrationTracking.DATA_PLANE.SCHEMA_NAME,
      migrationsTable: MigrationTracking.DATA_PLANE.TABLE_NAME,
    });

    dbPool = new Pool({
      connectionString: databaseStack.directUrl,
    });
  }, IntegrationTestTimeoutMs);

  afterAll(async () => {
    for (const volumeName of createdVolumeNames) {
      deleteVolume(volumeName);
    }

    await dbPool?.end();
    await databaseStack?.stop();
  });

  beforeEach(async () => {
    await createDataPlaneDb().delete(sandboxInstanceStorages);
    await createDataPlaneDb().delete(sandboxInstances);
  });

  afterEach(async () => {
    for (const volumeName of createdVolumeNames) {
      deleteVolume(volumeName);
    }
    createdVolumeNames.clear();
  });

  it(
    "provisions a Docker volume row end to end and is idempotent on repeat calls",
    async () => {
      const organizationId = `org_pr12_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
      const sandboxInstanceId = `sbi_pr12_${randomUUID().replaceAll("-", "").slice(0, 12)}`;

      await ensureSandboxInstance(
        {
          db: createDataPlaneDb(),
          runtimeProvider: SandboxProvider.DOCKER,
        },
        {
          sandboxInstanceId,
          organizationId,
          sandboxProfileId: "sbp_pr12_integration",
          sandboxProfileVersion: 1,
          persistenceMode: SandboxInstancePersistenceModes.PERSISTENT,
          startedBy: {
            kind: "system",
            id: "worker_pr12_integration",
          },
          source: "dashboard",
        },
      );

      const storageBackendAdapter = createDockerVolumeStorageBackendAdapter({
        db: createDataPlaneDb(),
      });

      const provisionedStorage = await storageBackendAdapter.provision({
        organizationId,
        sandboxInstanceId,
      });
      createdVolumeNames.add(provisionedStorage.handle);

      expect(provisionedStorage).toEqual({
        backend: SandboxStorageBackend.DOCKER_VOLUME,
        handle: `it-pr12-${sandboxInstanceId}`,
        status: "ready",
      });
      expect(volumeExists(provisionedStorage.handle)).toBe(true);

      const persistedStorage = await createDataPlaneDb().query.sandboxInstanceStorages.findFirst({
        where: (table, { eq }) => eq(table.sandboxInstanceId, sandboxInstanceId),
      });

      expect(persistedStorage).toMatchObject({
        sandboxInstanceId,
        provider: SandboxStorageProviders.DOCKER_VOLUME,
        handle: `it-pr12-${sandboxInstanceId}`,
        region: null,
        status: SandboxStorageStatuses.READY,
        credentialCiphertext: null,
        credentialNonce: null,
        credentialKind: null,
        organizationCredentialKeyVersion: null,
      });

      const provisionedStorageAgain = await storageBackendAdapter.provision({
        organizationId,
        sandboxInstanceId,
      });

      expect(provisionedStorageAgain).toEqual(provisionedStorage);
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "deletes the Docker volume and removes the storage row",
    async () => {
      const organizationId = `org_pr12_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
      const sandboxInstanceId = `sbi_pr12_${randomUUID().replaceAll("-", "").slice(0, 12)}`;

      await ensureSandboxInstance(
        {
          db: createDataPlaneDb(),
          runtimeProvider: SandboxProvider.DOCKER,
        },
        {
          sandboxInstanceId,
          organizationId,
          sandboxProfileId: "sbp_pr12_integration",
          sandboxProfileVersion: 1,
          persistenceMode: SandboxInstancePersistenceModes.PERSISTENT,
          startedBy: {
            kind: "system",
            id: "worker_pr12_integration",
          },
          source: "dashboard",
        },
      );

      const storageBackendAdapter = createDockerVolumeStorageBackendAdapter({
        db: createDataPlaneDb(),
      });

      const provisionedStorage = await storageBackendAdapter.provision({
        organizationId,
        sandboxInstanceId,
      });
      createdVolumeNames.add(provisionedStorage.handle);

      await storageBackendAdapter.deprovision({
        organizationId,
        sandboxInstanceId,
      });

      expect(volumeExists(provisionedStorage.handle)).toBe(false);
      createdVolumeNames.delete(provisionedStorage.handle);
      await expect(
        createDataPlaneDb().query.sandboxInstanceStorages.findFirst({
          where: (table, { eq }) => eq(table.sandboxInstanceId, sandboxInstanceId),
        }),
      ).resolves.toBeUndefined();
    },
    IntegrationTestTimeoutMs,
  );
});
