import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import { getLocalTestSandboxBaseImageRef } from "@mistle/config";
import { ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import {
  createDataPlaneDatabase,
  sandboxInstanceStorages,
  sandboxInstances,
  SandboxInstancePersistenceModes,
  SandboxInstancePurposes,
  SandboxStorageProviders,
  SandboxStorageStatuses,
} from "@mistle/db/data-plane";
import {
  DATA_PLANE_MIGRATIONS_FOLDER_PATH,
  MigrationTracking,
  runDataPlaneMigrations,
} from "@mistle/db/migrator";
import {
  createSandboxAdapter,
  SandboxPersistentStorageLayout,
  SandboxProvider,
  SandboxStorageBackend,
} from "@mistle/sandbox";
import { startPostgresWithPgBouncer } from "@mistle/test-harness";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  createDataPlaneWorkerRuntimeConfig,
  loadDataPlaneWorkerConfig,
  type DataPlaneWorkerConfig,
} from "../openworkflow/core/config.js";
import { destroySandbox } from "../openworkflow/shared/destroy-sandbox.js";
import { createSandboxStorageBackendAdapter } from "../openworkflow/shared/sandbox-storage/create-sandbox-storage-backend-adapter.js";
import { ensureSandboxInstance } from "../openworkflow/start-sandbox-instance/ensure-sandbox-instance.js";

const IntegrationTestTimeoutMs = 120_000;
const DockerSocketPath = "/var/run/docker.sock";
const LocalTestSandboxBaseImageRef = getLocalTestSandboxBaseImageRef();

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
    runtimeState: {
      gatewayBaseUrl: "http://127.0.0.1:5202",
    },
    controlPlaneApi: {
      baseUrl: "http://127.0.0.1:5100",
    },
    sandbox: {
      provider: "docker",
      storage: {
        backend: "docker_volume",
      },
      internalGatewayWsUrl: "ws://127.0.0.1:5003/tunnel/sandbox",
      bootstrap: {
        tokenSecret: "integration-bootstrap-secret",
        tokenIssuer: "integration-data-plane-worker",
        tokenAudience: "integration-data-plane-gateway",
      },
      egress: {
        tokenSecret: "integration-egress-secret",
        tokenIssuer: "integration-data-plane-worker",
        tokenAudience: "integration-tokenizer-proxy",
      },
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
    internalAuth: {
      serviceToken: "integration-service-token",
    },
    telemetry: {
      enabled: false,
      debug: false,
    },
  };
}

function createWorkerRuntimeConfig() {
  const loadedConfig = loadDataPlaneWorkerConfig({
    NODE_ENV: "development",
    MISTLE_TELEMETRY_ENABLED: "false",
    MISTLE_TELEMETRY_DEBUG: "false",
    MISTLE_INTERNAL_AUTH_SHARED_TOKEN: "integration-service-token",
    MISTLE_SANDBOX_PROVIDER: "docker",
    MISTLE_SANDBOX_DEFAULT_BASE_IMAGE: LocalTestSandboxBaseImageRef,
    MISTLE_SERVICES_DATA_PLANE_GATEWAY_SANDBOX_WS_PUBLIC_URL: "ws://127.0.0.1:5003/tunnel/sandbox",
    MISTLE_SERVICES_DATA_PLANE_GATEWAY_SANDBOX_WS_INTERNAL_URL:
      "ws://127.0.0.1:5003/tunnel/sandbox",
    MISTLE_SANDBOX_TOKENS_CONNECT_SECRET: "integration-connect-secret",
    MISTLE_SANDBOX_TOKENS_CONNECT_ISSUER: "integration-control-plane-api",
    MISTLE_SANDBOX_TOKENS_CONNECT_AUDIENCE: "integration-data-plane-gateway",
    MISTLE_SANDBOX_TOKENS_BOOTSTRAP_SECRET: "integration-bootstrap-secret",
    MISTLE_SANDBOX_TOKENS_BOOTSTRAP_ISSUER: "integration-data-plane-worker",
    MISTLE_SANDBOX_TOKENS_BOOTSTRAP_AUDIENCE: "integration-data-plane-gateway",
    MISTLE_SANDBOX_TOKENS_EGRESS_SECRET: "integration-egress-secret",
    MISTLE_SANDBOX_TOKENS_EGRESS_ISSUER: "integration-data-plane-worker",
    MISTLE_SANDBOX_TOKENS_EGRESS_AUDIENCE: "integration-tokenizer-proxy",
    MISTLE_SANDBOX_PUBLISH_BASE_DOMAIN: "mistle.example.test",
    MISTLE_SANDBOX_PUBLISH_ACCESS_TOKEN_SECRET: "integration-publish-secret",
    MISTLE_SANDBOX_PUBLISH_ACCESS_TOKEN_ISSUER: "integration-control-plane-api",
    MISTLE_SANDBOX_PUBLISH_ACCESS_TOKEN_AUDIENCE: "integration-data-plane-gateway",
    MISTLE_SANDBOX_PUBLISH_SESSION_COOKIE_SIGNING_SECRET: "integration-publish-cookie-secret",
    MISTLE_SANDBOX_STORAGE_BACKEND: "docker_volume",
    MISTLE_POSTGRES_DATA_PLANE_POOLED_URL: "postgresql://unused",
    MISTLE_WORKFLOW_DATA_PLANE_NAMESPACE_ID: "integration",
    MISTLE_SERVICES_DATA_PLANE_WORKER_WORKFLOW_CONCURRENCY: "1",
    MISTLE_SERVICES_DATA_PLANE_GATEWAY_INTERNAL_URL: "http://127.0.0.1:5202",
    MISTLE_SERVICES_CONTROL_PLANE_API_INTERNAL_URL: "http://127.0.0.1:5100",
    MISTLE_SERVICES_TOKENIZER_PROXY_EGRESS_URL: "http://tokenizer-proxy/tokenizer-proxy/egress",
    MISTLE_SANDBOX_DOCKER_SOCKET_PATH: DockerSocketPath,
    MISTLE_SANDBOX_STORAGE_DOCKER_VOLUME_NAME_PREFIX: "it-pr12-",
  });
  return createDataPlaneWorkerRuntimeConfig({
    app: loadedConfig.app,
  });
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
          purpose: SandboxInstancePurposes.SESSION,
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
          purpose: SandboxInstancePurposes.SESSION,
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

  it(
    "destroys persistent Docker sandboxes by tearing down compute, deleting the volume, and removing the storage row",
    async () => {
      const organizationId = `org_pr13_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
      const sandboxInstanceId = `sbi_pr13_${randomUUID().replaceAll("-", "").slice(0, 12)}`;

      await ensureSandboxInstance(
        {
          db: createDataPlaneDb(),
          runtimeProvider: SandboxProvider.DOCKER,
        },
        {
          sandboxInstanceId,
          organizationId,
          sandboxProfileId: "sbp_pr13_integration",
          sandboxProfileVersion: 1,
          persistenceMode: SandboxInstancePersistenceModes.PERSISTENT,
          purpose: SandboxInstancePurposes.SESSION,
          startedBy: {
            kind: "system",
            id: "worker_pr13_integration",
          },
          source: "dashboard",
        },
      );

      const storageBackendAdapter = createDockerVolumeStorageBackendAdapter({
        db: createDataPlaneDb(),
      });
      const sandboxAdapter = createSandboxAdapter({
        provider: SandboxProvider.DOCKER,
        docker: {
          socketPath: DockerSocketPath,
        },
      });

      const provisionedStorage = await storageBackendAdapter.provision({
        organizationId,
        sandboxInstanceId,
      });
      createdVolumeNames.add(provisionedStorage.handle);

      const storageAttachment = await storageBackendAdapter.resolveAttachment({
        organizationId,
        sandboxInstanceId,
      });
      const storagePreparation = await sandboxAdapter.prepareStorageForStart({
        sandboxInstanceId,
        image: {
          provider: SandboxProvider.DOCKER,
          imageId: "registry:3",
          createdAt: new Date().toISOString(),
        },
        storage: {
          ...storageAttachment,
          layout: SandboxPersistentStorageLayout,
        },
      });
      const sandbox = await sandboxAdapter.start({
        image: {
          provider: SandboxProvider.DOCKER,
          imageId: "registry:3",
          createdAt: new Date().toISOString(),
        },
        storagePreparation,
      });

      await destroySandbox(
        {
          db: createDataPlaneDb(),
          controlPlaneInternalClient: new ControlPlaneInternalClient({
            baseUrl: "http://127.0.0.1:1",
            internalAuthServiceToken: "unused",
          }),
          config: createWorkerRuntimeConfig(),
          sandboxAdapter,
        },
        {
          sandboxInstanceId,
          organizationId,
          persistenceMode: SandboxInstancePersistenceModes.PERSISTENT,
          runtimeProvider: SandboxProvider.DOCKER,
          providerSandboxId: sandbox.id,
        },
      );

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
