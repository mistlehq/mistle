import { randomUUID } from "node:crypto";

import { ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import {
  createControlPlaneDatabase,
  organizationCredentialKeys,
  organizationSandboxStorageSettings,
  organizations,
  SandboxStorageConfigSources,
} from "@mistle/db/control-plane";
import {
  getDataPlaneDatabaseSchema,
  createDataPlaneDatabase,
  sandboxInstanceStorages,
  sandboxInstances,
  SandboxInstancePersistenceModes,
  SandboxInstancePurposes,
  SandboxStorageCredentialKinds,
  SandboxStorageProviders,
  SandboxStorageStatuses,
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

import { ensureCommitSignBinary } from "../../control-plane-api/integration/helpers/commit-sign.js";
import { createSandboxStorageBackendAdapter } from "../openworkflow/shared/sandbox-storage/create-sandbox-storage-backend-adapter.js";
import { insertSandboxInstanceStorage } from "../openworkflow/shared/sandbox-storage/storage-persistence.js";
import { ensureSandboxInstance } from "../openworkflow/start-sandbox-instance/ensure-sandbox-instance.js";
import { startControlPlaneApiProcess } from "./helpers/control-plane-api.js";
import { insertInitialOrganizationCredentialKey } from "./helpers/organization-credential-keys.js";

const IntegrationTestTimeoutMs = 60_000;
const InternalAuthServiceToken = "integration-service-token";
const MasterEncryptionKeyVersion = 1;
const OrganizationCredentialKeyVersion = 1;
const MasterEncryptionKeys = {
  "1": "integration-master-key-testing",
} as const;

type DatabaseStack = {
  directUrl: string;
  stop: () => Promise<void>;
};

let databaseStack: DatabaseStack | undefined;
let dbPool: Pool | undefined;
let controlPlaneApi: Awaited<ReturnType<typeof startControlPlaneApiProcess>> | undefined;
let commitSignBinaryPath: string | undefined;

function getCommitSignBinaryPath(): string {
  if (commitSignBinaryPath === undefined) {
    throw new Error("Expected commit-sign binary path to be initialized.");
  }

  return commitSignBinaryPath;
}

function getDbPool(): Pool {
  if (dbPool === undefined) {
    throw new Error("Expected integration database pool to be initialized.");
  }

  return dbPool;
}

function createControlPlaneDb() {
  return createControlPlaneDatabase(getDbPool());
}

function createDataPlaneDb() {
  return createDataPlaneDatabase(getDbPool());
}

function createArchilStorageBackendAdapter(input: {
  db: ReturnType<typeof createDataPlaneDb>;
  tables?: ReturnType<typeof getDataPlaneDatabaseSchema>;
  controlPlaneInternalClient: ControlPlaneInternalClient;
}) {
  return createSandboxStorageBackendAdapter({
    db: input.db,
    tables: getDataPlaneDatabaseSchema(input.db),
    controlPlaneInternalClient: input.controlPlaneInternalClient,
    workerConfig: {
      database: { url: "postgresql://unused" },
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
        provider: "e2b",
        storage: {
          backend: "archil",
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
      },
      sandboxStorage: {
        archil: {
          apiKey: "managed-api-key",
          region: "aws-us-east-1",
        },
      },
      internalAuth: {
        serviceToken: "integration-service-token",
      },
      telemetry: {
        enabled: false,
        debug: false,
      },
    },
    runtimeProvider: SandboxProvider.E2B,
    storageBackend: SandboxStorageBackend.ARCHIL,
  });
}

async function seedOrganizationWithCredentialKey(input: { organizationId: string }): Promise<void> {
  const controlPlaneDb = createControlPlaneDb();

  await controlPlaneDb.insert(organizations).values({
    id: input.organizationId,
    slug: `org-pr5-${randomUUID().replaceAll("-", "").slice(0, 12)}`,
    name: "PR5 integration organization",
  });
  await insertInitialOrganizationCredentialKey({
    db: controlPlaneDb,
    organizationId: input.organizationId,
    organizationCredentialKeyVersion: OrganizationCredentialKeyVersion,
    masterEncryptionKeyVersion: MasterEncryptionKeyVersion,
    masterEncryptionKeys: MasterEncryptionKeys,
  });
  await controlPlaneDb.insert(organizationSandboxStorageSettings).values({
    organizationId: input.organizationId,
    persistentSandboxesEnabled: true,
    storageConfigSource: SandboxStorageConfigSources.MANAGED,
  });
}

describe("resolve ready Archil sandbox storage integration", () => {
  beforeAll(async () => {
    commitSignBinaryPath = await ensureCommitSignBinary();
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
      commitSignBinaryPath: getCommitSignBinaryPath(),
    });
  }, IntegrationTestTimeoutMs);

  afterAll(async () => {
    await controlPlaneApi?.stop();
    await dbPool?.end();
    await databaseStack?.stop();
  });

  beforeEach(async () => {
    await createDataPlaneDb().delete(sandboxInstanceStorages);
    await createDataPlaneDb().delete(sandboxInstances);
    await createControlPlaneDb().delete(organizationSandboxStorageSettings);
    await createControlPlaneDb().delete(organizationCredentialKeys);
    await createControlPlaneDb().delete(organizations);
  });

  it(
    "loads the ready Archil storage row and resolves its disk token through control plane",
    async () => {
      if (controlPlaneApi === undefined) {
        throw new Error("Expected control-plane API process to be initialized.");
      }

      const controlPlaneInternalClient = new ControlPlaneInternalClient({
        baseUrl: controlPlaneApi.baseUrl,
        internalAuthServiceToken: InternalAuthServiceToken,
      });
      const organizationId = `org_pr5_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
      const sandboxInstanceId = `sbi_pr5_${randomUUID().replaceAll("-", "").slice(0, 12)}`;

      await seedOrganizationWithCredentialKey({
        organizationId,
      });

      await ensureSandboxInstance(
        {
          db: createDataPlaneDb(),
          tables: getDataPlaneDatabaseSchema(createDataPlaneDb()),
          runtimeProvider: "e2b",
        },
        {
          sandboxInstanceId,
          organizationId,
          sandboxProfileId: "sbp_pr5_integration",
          sandboxProfileVersion: 1,
          persistenceMode: SandboxInstancePersistenceModes.PERSISTENT,
          purpose: SandboxInstancePurposes.SESSION,
          startedBy: {
            kind: "system",
            id: "worker_pr5_integration",
          },
          source: "dashboard",
        },
      );

      const encryptedCredential = await controlPlaneInternalClient.encryptStorageCredential({
        organizationId,
        credentialKind: "disk_token",
        plaintext: "disk-token-pr5",
      });

      await insertSandboxInstanceStorage(
        {
          db: createDataPlaneDb(),
          tables: getDataPlaneDatabaseSchema(createDataPlaneDb()),
        },
        {
          sandboxInstanceId,
          provider: SandboxStorageProviders.ARCHIL,
          handle: "dsk-0123456789abcdef",
          region: "aws-us-east-1",
          status: SandboxStorageStatuses.READY,
          credentialCiphertext: encryptedCredential.ciphertext,
          credentialNonce: encryptedCredential.nonce,
          credentialKind: SandboxStorageCredentialKinds.DISK_TOKEN,
          organizationCredentialKeyVersion: encryptedCredential.organizationCredentialKeyVersion,
        },
      );

      const storageBackendAdapter = createArchilStorageBackendAdapter({
        db: createDataPlaneDb(),
        tables: getDataPlaneDatabaseSchema(createDataPlaneDb()),
        controlPlaneInternalClient,
      });

      const resolvedStorage = await storageBackendAdapter.resolveAttachment({
        organizationId,
        sandboxInstanceId,
      });

      if (resolvedStorage.backend !== SandboxStorageBackend.ARCHIL) {
        throw new Error("Expected Archil sandbox storage attachment.");
      }

      expect(resolvedStorage.credential).toBe("disk-token-pr5");
      expect(resolvedStorage).toMatchObject({
        backend: SandboxStorageBackend.ARCHIL,
        handle: "dsk-0123456789abcdef",
        region: "aws-us-east-1",
      });
    },
    IntegrationTestTimeoutMs,
  );

  it("fails when no sandbox storage row exists", async () => {
    if (controlPlaneApi === undefined) {
      throw new Error("Expected control-plane API process to be initialized.");
    }

    const controlPlaneInternalClient = new ControlPlaneInternalClient({
      baseUrl: controlPlaneApi.baseUrl,
      internalAuthServiceToken: InternalAuthServiceToken,
    });
    const organizationId = `org_pr5_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const sandboxInstanceId = `sbi_pr5_${randomUUID().replaceAll("-", "").slice(0, 12)}`;

    await seedOrganizationWithCredentialKey({
      organizationId,
    });

    await ensureSandboxInstance(
      {
        db: createDataPlaneDb(),
        tables: getDataPlaneDatabaseSchema(createDataPlaneDb()),
        runtimeProvider: "e2b",
      },
      {
        sandboxInstanceId,
        organizationId,
        sandboxProfileId: "sbp_pr5_integration",
        sandboxProfileVersion: 1,
        persistenceMode: SandboxInstancePersistenceModes.PERSISTENT,
        purpose: SandboxInstancePurposes.SESSION,
        startedBy: {
          kind: "system",
          id: "worker_pr5_integration",
        },
        source: "dashboard",
      },
    );

    const storageBackendAdapter = createArchilStorageBackendAdapter({
      db: createDataPlaneDb(),
      tables: getDataPlaneDatabaseSchema(createDataPlaneDb()),
      controlPlaneInternalClient,
    });

    await expect(
      storageBackendAdapter.resolveAttachment({
        organizationId,
        sandboxInstanceId,
      }),
    ).rejects.toThrow(
      `Sandbox storage row for sandbox instance '${sandboxInstanceId}' was not found.`,
    );
  });

  it("fails when the sandbox storage row is not ready", async () => {
    if (controlPlaneApi === undefined) {
      throw new Error("Expected control-plane API process to be initialized.");
    }

    const controlPlaneInternalClient = new ControlPlaneInternalClient({
      baseUrl: controlPlaneApi.baseUrl,
      internalAuthServiceToken: InternalAuthServiceToken,
    });
    const organizationId = `org_pr5_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const sandboxInstanceId = `sbi_pr5_${randomUUID().replaceAll("-", "").slice(0, 12)}`;

    await seedOrganizationWithCredentialKey({
      organizationId,
    });

    await ensureSandboxInstance(
      {
        db: createDataPlaneDb(),
        tables: getDataPlaneDatabaseSchema(createDataPlaneDb()),
        runtimeProvider: "e2b",
      },
      {
        sandboxInstanceId,
        organizationId,
        sandboxProfileId: "sbp_pr5_integration",
        sandboxProfileVersion: 1,
        persistenceMode: SandboxInstancePersistenceModes.PERSISTENT,
        purpose: SandboxInstancePurposes.SESSION,
        startedBy: {
          kind: "system",
          id: "worker_pr5_integration",
        },
        source: "dashboard",
      },
    );

    const encryptedCredential = await controlPlaneInternalClient.encryptStorageCredential({
      organizationId,
      credentialKind: "disk_token",
      plaintext: "disk-token-pr5",
    });

    await insertSandboxInstanceStorage(
      {
        db: createDataPlaneDb(),
        tables: getDataPlaneDatabaseSchema(createDataPlaneDb()),
      },
      {
        sandboxInstanceId,
        provider: SandboxStorageProviders.ARCHIL,
        handle: "dsk-0123456789abcdef",
        region: "aws-us-east-1",
        status: SandboxStorageStatuses.FAILED,
        credentialCiphertext: encryptedCredential.ciphertext,
        credentialNonce: encryptedCredential.nonce,
        credentialKind: SandboxStorageCredentialKinds.DISK_TOKEN,
        organizationCredentialKeyVersion: encryptedCredential.organizationCredentialKeyVersion,
      },
    );

    const storageBackendAdapter = createArchilStorageBackendAdapter({
      db: createDataPlaneDb(),
      tables: getDataPlaneDatabaseSchema(createDataPlaneDb()),
      controlPlaneInternalClient,
    });

    await expect(
      storageBackendAdapter.resolveAttachment({
        organizationId,
        sandboxInstanceId,
      }),
    ).rejects.toThrow(
      `Sandbox storage row for sandbox instance '${sandboxInstanceId}' is not ready; found status 'failed'.`,
    );
  });

  it("propagates control-plane decrypt failures unchanged", async () => {
    if (controlPlaneApi === undefined) {
      throw new Error("Expected control-plane API process to be initialized.");
    }

    const controlPlaneInternalClient = new ControlPlaneInternalClient({
      baseUrl: controlPlaneApi.baseUrl,
      internalAuthServiceToken: InternalAuthServiceToken,
    });
    const organizationId = `org_pr5_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const wrongOrganizationId = `org_pr5_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const sandboxInstanceId = `sbi_pr5_${randomUUID().replaceAll("-", "").slice(0, 12)}`;

    await seedOrganizationWithCredentialKey({
      organizationId,
    });

    await ensureSandboxInstance(
      {
        db: createDataPlaneDb(),
        tables: getDataPlaneDatabaseSchema(createDataPlaneDb()),
        runtimeProvider: "e2b",
      },
      {
        sandboxInstanceId,
        organizationId,
        sandboxProfileId: "sbp_pr5_integration",
        sandboxProfileVersion: 1,
        persistenceMode: SandboxInstancePersistenceModes.PERSISTENT,
        purpose: SandboxInstancePurposes.SESSION,
        startedBy: {
          kind: "system",
          id: "worker_pr5_integration",
        },
        source: "dashboard",
      },
    );

    const encryptedCredential = await controlPlaneInternalClient.encryptStorageCredential({
      organizationId,
      credentialKind: "disk_token",
      plaintext: "disk-token-pr5",
    });

    await insertSandboxInstanceStorage(
      {
        db: createDataPlaneDb(),
        tables: getDataPlaneDatabaseSchema(createDataPlaneDb()),
      },
      {
        sandboxInstanceId,
        provider: SandboxStorageProviders.ARCHIL,
        handle: "dsk-0123456789abcdef",
        region: "aws-us-east-1",
        status: SandboxStorageStatuses.READY,
        credentialCiphertext: encryptedCredential.ciphertext,
        credentialNonce: encryptedCredential.nonce,
        credentialKind: SandboxStorageCredentialKinds.DISK_TOKEN,
        organizationCredentialKeyVersion: encryptedCredential.organizationCredentialKeyVersion,
      },
    );

    const storageBackendAdapter = createArchilStorageBackendAdapter({
      db: createDataPlaneDb(),
      tables: getDataPlaneDatabaseSchema(createDataPlaneDb()),
      controlPlaneInternalClient,
    });

    await expect(
      storageBackendAdapter.resolveAttachment({
        organizationId: wrongOrganizationId,
        sandboxInstanceId,
      }),
    ).rejects.toThrow(
      "Control-plane internal storage credential resolve failed with status 500: Unknown control-plane internal API error.",
    );
  });
});
