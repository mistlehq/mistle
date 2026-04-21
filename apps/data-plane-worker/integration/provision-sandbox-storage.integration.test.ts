import { spawn, type ChildProcessByStdio } from "node:child_process";
import { createCipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

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
  SandboxStorageStatuses,
  createDataPlaneDatabase as createDataPlaneDataPlaneDatabase,
  sandboxInstanceStorages,
  sandboxInstances,
  SandboxInstancePersistenceModes,
  SandboxStorageProviders,
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
import { systemClock, systemSleeper } from "@mistle/time";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { ensureCommitSignBinaryInstalled } from "../../control-plane-api/integration/helpers/commit-sign.js";
import type { DataPlaneWorkerConfig } from "../openworkflow/core/config.js";
import {
  createArchilDiskName,
  createArchilDiskRequest,
} from "../openworkflow/shared/sandbox-storage/archil-storage-backend.js";
import { createSandboxStorageBackendAdapter } from "../openworkflow/shared/sandbox-storage/create-sandbox-storage-backend-adapter.js";
import { ensureSandboxInstance } from "../openworkflow/start-sandbox-instance/ensure-sandbox-instance.js";

const IntegrationTestTimeoutMs = 120_000;
const ControlPlaneApiHealthcheckPath = "/__healthz";
const ControlPlaneApiStartupTimeoutMs = 20_000;
const ControlPlaneApiShutdownTimeoutMs = 5_000;
const ControlPlaneApiHealthPollIntervalMs = 100;
const InternalAuthServiceToken = "integration-service-token";
const MasterEncryptionKeyVersion = 1;
const TestArchilRegion = "gcp-us-central1";
const OrganizationCredentialKeyVersion = 1;
const OrganizationCredentialKeyByteLength = 32;
const WrappedOrganizationKeyFormatVersion = "v1";
const AesGcmNonceByteLength = 12;
const MasterEncryptionKeys = {
  "1": "integration-master-key-testing",
} as const;
const RepoRootPath = fileURLToPath(new URL("../../..", import.meta.url));

const ArchilIntegrationEnvironmentSchema = z
  .object({
    MISTLE_TEST_ARCHIL_API_KEY: z.string().min(1),
    MISTLE_TEST_ARCHIL_S3_BUCKET: z.string().min(1),
    MISTLE_TEST_ARCHIL_S3_ENDPOINT: z.url(),
    MISTLE_TEST_ARCHIL_S3_ACCESS_KEY_ID: z.string().min(1),
    MISTLE_TEST_ARCHIL_S3_SECRET_ACCESS_KEY: z.string().min(1),
  })
  .strict();

type ArchilIntegrationEnvironment = z.infer<typeof ArchilIntegrationEnvironmentSchema>;

type DatabaseStack = {
  directUrl: string;
  stop: () => Promise<void>;
};

type ControlPlaneApiChildProcess = ChildProcessByStdio<null, Readable, Readable>;

type StartedControlPlaneApiProcess = {
  baseUrl: string;
  stop: () => Promise<void>;
};

function readArchilIntegrationEnvironment(): ArchilIntegrationEnvironment | null {
  const parsedEnvironment = ArchilIntegrationEnvironmentSchema.safeParse({
    MISTLE_TEST_ARCHIL_API_KEY: process.env.MISTLE_TEST_ARCHIL_API_KEY,
    MISTLE_TEST_ARCHIL_S3_BUCKET: process.env.MISTLE_TEST_ARCHIL_S3_BUCKET,
    MISTLE_TEST_ARCHIL_S3_ENDPOINT: process.env.MISTLE_TEST_ARCHIL_S3_ENDPOINT,
    MISTLE_TEST_ARCHIL_S3_ACCESS_KEY_ID: process.env.MISTLE_TEST_ARCHIL_S3_ACCESS_KEY_ID,
    MISTLE_TEST_ARCHIL_S3_SECRET_ACCESS_KEY: process.env.MISTLE_TEST_ARCHIL_S3_SECRET_ACCESS_KEY,
  });

  if (!parsedEnvironment.success) {
    return null;
  }

  return parsedEnvironment.data;
}

function createArchilStorageBackendAdapter(input: {
  db: ReturnType<typeof createDataPlaneDataPlaneDatabase>;
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

async function requireSandboxStorageRow(input: {
  db: ReturnType<typeof createDataPlaneDataPlaneDatabase>;
  sandboxInstanceId: string;
}) {
  const sandboxStorage = await input.db.query.sandboxInstanceStorages.findFirst({
    where: (table, { eq }) => eq(table.sandboxInstanceId, input.sandboxInstanceId),
  });

  if (sandboxStorage === undefined) {
    throw new Error(
      `Expected sandbox storage row for sandbox instance '${input.sandboxInstanceId}'.`,
    );
  }

  return sandboxStorage;
}

const archilIntegrationEnvironment = readArchilIntegrationEnvironment();
const describeIfArchilIntegration =
  archilIntegrationEnvironment === null ? describe.skip : describe;

function createControlPlaneApiEnvironment(input: {
  host: string;
  port: number;
  databaseUrl: string;
  dataPlaneApiBaseUrl: string;
  workflowNamespaceId: string;
  internalAuthServiceToken: string;
  sandboxStorageBackend: typeof SandboxStorageBackend.ARCHIL;
}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NODE_ENV: "development",
    NO_COLOR: "1",
    MISTLE_GLOBAL_TELEMETRY_ENABLED: "false",
    MISTLE_GLOBAL_TELEMETRY_DEBUG: "false",
    MISTLE_TEST_CONTROL_PLANE_API_HOST: input.host,
    MISTLE_TEST_CONTROL_PLANE_API_PORT: String(input.port),
    MISTLE_TEST_CONTROL_PLANE_API_DATABASE_URL: input.databaseUrl,
    MISTLE_TEST_CONTROL_PLANE_API_DATA_PLANE_API_BASE_URL: input.dataPlaneApiBaseUrl,
    MISTLE_TEST_CONTROL_PLANE_API_WORKFLOW_NAMESPACE_ID: input.workflowNamespaceId,
    MISTLE_TEST_CONTROL_PLANE_API_INTERNAL_AUTH_SERVICE_TOKEN: input.internalAuthServiceToken,
    MISTLE_TEST_CONTROL_PLANE_API_SANDBOX_STORAGE_BACKEND: input.sandboxStorageBackend,
  };
}

function startControlPlaneApiChildProcess(input: {
  host: string;
  port: number;
  databaseUrl: string;
  dataPlaneApiBaseUrl: string;
  workflowNamespaceId: string;
  internalAuthServiceToken: string;
  sandboxStorageBackend: typeof SandboxStorageBackend.ARCHIL;
}): ControlPlaneApiChildProcess {
  return spawn(
    "pnpm",
    ["exec", "tsx", "apps/data-plane-api/integration/helpers/start-control-plane-api.ts"],
    {
      cwd: RepoRootPath,
      env: createControlPlaneApiEnvironment(input),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

async function waitForControlPlaneApiHealth(input: {
  childProcess: ControlPlaneApiChildProcess;
  baseUrl: string;
  startupLogs: { stdout: string; stderr: string };
}): Promise<void> {
  const deadline = systemClock.nowMs() + ControlPlaneApiStartupTimeoutMs;

  while (systemClock.nowMs() < deadline) {
    if (input.childProcess.exitCode !== null) {
      throw new Error(
        `control-plane-api exited before becoming healthy (code=${String(input.childProcess.exitCode)}).\nstdout:\n${input.startupLogs.stdout}\nstderr:\n${input.startupLogs.stderr}`,
      );
    }

    try {
      const response = await fetch(`${input.baseUrl}${ControlPlaneApiHealthcheckPath}`);
      if (response.ok) {
        return;
      }
    } catch {}

    await systemSleeper.sleep(ControlPlaneApiHealthPollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for control-plane-api health.\nstdout:\n${input.startupLogs.stdout}\nstderr:\n${input.startupLogs.stderr}`,
  );
}

async function startControlPlaneApiProcess(input: {
  host: string;
  port: number;
  databaseUrl: string;
  dataPlaneApiBaseUrl: string;
  workflowNamespaceId: string;
  internalAuthServiceToken: string;
  sandboxStorageBackend: typeof SandboxStorageBackend.ARCHIL;
}): Promise<StartedControlPlaneApiProcess> {
  const childProcess = startControlPlaneApiChildProcess(input);
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];

  childProcess.stdout.setEncoding("utf8");
  childProcess.stderr.setEncoding("utf8");
  childProcess.stdout.on("data", (chunk: string) => {
    stdoutChunks.push(chunk);
  });
  childProcess.stderr.on("data", (chunk: string) => {
    stderrChunks.push(chunk);
  });

  const baseUrl = `http://${input.host}:${String(input.port)}`;
  await waitForControlPlaneApiHealth({
    childProcess,
    baseUrl,
    startupLogs: {
      stdout: stdoutChunks.join(""),
      stderr: stderrChunks.join(""),
    },
  });

  return {
    baseUrl,
    stop: async () => {
      if (childProcess.exitCode !== null) {
        return;
      }

      childProcess.kill("SIGTERM");
      const shutdownDeadline = systemClock.nowMs() + ControlPlaneApiShutdownTimeoutMs;
      while (childProcess.exitCode === null && systemClock.nowMs() < shutdownDeadline) {
        await systemSleeper.sleep(50);
      }

      if (childProcess.exitCode === null) {
        childProcess.kill("SIGKILL");
      }
    },
  };
}

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
        namePrefix: "it-pr4-",
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

function createSandboxInstanceId(suffix: string): string {
  return `sbi_pr4_${suffix}`;
}

function wrapOrganizationCredentialKey(input: {
  organizationCredentialKey: Buffer;
  masterEncryptionKeyMaterial: string;
}): string {
  const encryptionKey = createHash("sha256")
    .update(input.masterEncryptionKeyMaterial, "utf8")
    .digest();
  const nonce = randomBytes(AesGcmNonceByteLength);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, nonce);

  try {
    const ciphertext = Buffer.concat([
      cipher.update(input.organizationCredentialKey),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    try {
      return [
        WrappedOrganizationKeyFormatVersion,
        nonce.toString("base64url"),
        ciphertext.toString("base64url"),
        authTag.toString("base64url"),
      ].join(".");
    } finally {
      ciphertext.fill(0);
      authTag.fill(0);
    }
  } finally {
    encryptionKey.fill(0);
    nonce.fill(0);
  }
}

async function insertInitialOrganizationCredentialKey(input: {
  db: ReturnType<typeof createControlPlaneDatabase>;
  organizationId: string;
}): Promise<void> {
  const organizationCredentialKey = randomBytes(OrganizationCredentialKeyByteLength);
  const masterEncryptionKeyMaterial = MasterEncryptionKeys["1"];

  if (masterEncryptionKeyMaterial === undefined) {
    throw new Error(
      `Master encryption key version '${String(MasterEncryptionKeyVersion)}' is missing.`,
    );
  }

  try {
    const ciphertext = wrapOrganizationCredentialKey({
      organizationCredentialKey,
      masterEncryptionKeyMaterial,
    });

    await input.db.insert(organizationCredentialKeys).values({
      organizationId: input.organizationId,
      version: OrganizationCredentialKeyVersion,
      masterKeyVersion: MasterEncryptionKeyVersion,
      ciphertext,
    });
  } finally {
    organizationCredentialKey.fill(0);
  }
}

describeIfArchilIntegration("provisionSandboxStorage integration", () => {
  let databaseStack: DatabaseStack | undefined;
  let dbPool: Pool | undefined;
  let controlPlaneApi: StartedControlPlaneApiProcess | undefined;
  const createdDiskIds = new Set<string>();

  const archilEnvironment = archilIntegrationEnvironment;

  if (archilEnvironment === null) {
    return;
  }

  const archil = new Archil({
    apiKey: archilEnvironment.MISTLE_TEST_ARCHIL_API_KEY,
    region: TestArchilRegion,
  });

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

  afterEach(async () => {
    if (dbPool === undefined) {
      return;
    }

    for (const diskId of createdDiskIds) {
      try {
        const disk = await archil.disks.get(diskId);
        await disk.delete();
      } catch {}
    }
    createdDiskIds.clear();

    const controlPlaneDb = createControlPlaneDatabase(dbPool);
    const dataPlaneDb = createDataPlaneDataPlaneDatabase(dbPool);

    await dataPlaneDb.delete(sandboxInstanceStorages);
    await dataPlaneDb.delete(sandboxInstances);
    await controlPlaneDb.delete(organizationSandboxStorageSettings);
    await controlPlaneDb.delete(organizationCredentialKeys);
    await controlPlaneDb.delete(organizations);
  });

  afterAll(async () => {
    await controlPlaneApi?.stop();
    await dbPool?.end();
    await databaseStack?.stop();
  });

  it(
    "provisions persistent sandbox storage end to end and is idempotent on repeat calls",
    async () => {
      if (dbPool === undefined || controlPlaneApi === undefined) {
        throw new Error("Expected integration infrastructure to be initialized.");
      }

      const controlPlaneDb = createControlPlaneDatabase(dbPool);
      const dataPlaneDb = createDataPlaneDataPlaneDatabase(dbPool);
      const controlPlaneInternalClient = new ControlPlaneInternalClient({
        baseUrl: controlPlaneApi.baseUrl,
        internalAuthServiceToken: InternalAuthServiceToken,
      });
      const organizationId = `org_pr4_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
      const sandboxInstanceId = createSandboxInstanceId(
        randomUUID().replaceAll("-", "").slice(0, 12),
      );

      await controlPlaneDb.insert(organizations).values({
        id: organizationId,
        slug: `org-pr4-${randomUUID().replaceAll("-", "").slice(0, 12)}`,
        name: "PR4 integration organization",
      });
      await insertInitialOrganizationCredentialKey({
        db: controlPlaneDb,
        organizationId,
      });
      await controlPlaneDb.insert(organizationSandboxStorageSettings).values({
        organizationId,
        persistentSandboxesEnabled: true,
        storageConfigSource: SandboxStorageConfigSources.MANAGED,
      });

      await ensureSandboxInstance(
        {
          db: dataPlaneDb,
          runtimeProvider: "e2b",
        },
        {
          sandboxInstanceId,
          organizationId,
          sandboxProfileId: "sbp_pr4_integration",
          sandboxProfileVersion: 1,
          persistenceMode: SandboxInstancePersistenceModes.PERSISTENT,
          startedBy: {
            kind: "system",
            id: "worker_pr4_integration",
          },
          source: "dashboard",
        },
      );

      const storageBackendAdapter = createArchilStorageBackendAdapter({
        db: dataPlaneDb,
        controlPlaneInternalClient,
        workerConfig: createWorkerConfig(archilEnvironment),
      });

      const provisionedStorage = await storageBackendAdapter.provision({
        organizationId,
        sandboxInstanceId,
      });
      createdDiskIds.add(provisionedStorage.handle);

      expect(provisionedStorage.backend).toBe(SandboxStorageBackend.ARCHIL);
      expect(provisionedStorage.status).toBe(SandboxStorageStatuses.READY);
      expect(provisionedStorage.handle).toMatch(/^dsk-[0-9a-f]{16}$/u);

      const persistedStorage = await requireSandboxStorageRow({
        db: dataPlaneDb,
        sandboxInstanceId,
      });

      expect(persistedStorage.provider).toBe(SandboxStorageProviders.ARCHIL);
      expect(persistedStorage.region).toBe(TestArchilRegion);
      expect(persistedStorage.credentialCiphertext).not.toBeNull();
      expect(persistedStorage.credentialNonce).not.toBeNull();
      expect(persistedStorage.organizationCredentialKeyVersion).not.toBeNull();

      if (
        persistedStorage.credentialCiphertext === null ||
        persistedStorage.credentialNonce === null ||
        persistedStorage.organizationCredentialKeyVersion === null
      ) {
        throw new Error("Expected persisted Archil credential fields.");
      }

      const decryptedCredential = await controlPlaneInternalClient.resolveStorageCredential({
        organizationId,
        credentialKind: "disk_token",
        ciphertext: persistedStorage.credentialCiphertext,
        nonce: persistedStorage.credentialNonce,
        organizationCredentialKeyVersion: persistedStorage.organizationCredentialKeyVersion,
      });

      expect(decryptedCredential.plaintext).not.toBe("");

      const provisionedDisk = await archil.disks.get(provisionedStorage.handle);
      expect(provisionedDisk.name).toBe(`it-pr4-${sandboxInstanceId}`);
      expect(provisionedDisk.mounts?.[0]?.config?.bucketPrefix).toBe(sandboxInstanceId);
      expect(provisionedDisk.authorizedUsers?.filter((user) => user.type === "token").length).toBe(
        1,
      );

      const provisionedStorageAgain = await storageBackendAdapter.provision({
        organizationId,
        sandboxInstanceId,
      });

      expect(provisionedStorageAgain.backend).toBe(provisionedStorage.backend);
      expect(provisionedStorageAgain.handle).toBe(provisionedStorage.handle);

      const diskAfterRepeat = await archil.disks.get(provisionedStorage.handle);
      expect(diskAfterRepeat.authorizedUsers?.filter((user) => user.type === "token").length).toBe(
        1,
      );
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "compensates the created Archil disk when credential encryption fails",
    async () => {
      if (dbPool === undefined || controlPlaneApi === undefined) {
        throw new Error("Expected integration infrastructure to be initialized.");
      }

      const controlPlaneDb = createControlPlaneDatabase(dbPool);
      const dataPlaneDb = createDataPlaneDataPlaneDatabase(dbPool);
      const controlPlaneInternalClient = new ControlPlaneInternalClient({
        baseUrl: controlPlaneApi.baseUrl,
        internalAuthServiceToken: InternalAuthServiceToken,
      });
      const organizationId = `org_pr4_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
      const sandboxInstanceId = createSandboxInstanceId(
        randomUUID().replaceAll("-", "").slice(0, 12),
      );
      const workerConfig = createWorkerConfig(archilEnvironment);
      const archilConfig = workerConfig.sandboxStorage?.archil;

      if (archilConfig === undefined) {
        throw new Error("Expected managed Archil worker config to be defined.");
      }

      await controlPlaneDb.insert(organizations).values({
        id: organizationId,
        slug: `org-pr4-${randomUUID().replaceAll("-", "").slice(0, 12)}`,
        name: "PR4 integration organization",
      });
      await controlPlaneDb.insert(organizationSandboxStorageSettings).values({
        organizationId,
        persistentSandboxesEnabled: true,
        storageConfigSource: SandboxStorageConfigSources.MANAGED,
      });

      await ensureSandboxInstance(
        {
          db: dataPlaneDb,
          runtimeProvider: "e2b",
        },
        {
          sandboxInstanceId,
          organizationId,
          sandboxProfileId: "sbp_pr4_integration",
          sandboxProfileVersion: 1,
          persistenceMode: SandboxInstancePersistenceModes.PERSISTENT,
          startedBy: {
            kind: "system",
            id: "worker_pr4_integration",
          },
          source: "dashboard",
        },
      );

      const storageBackendAdapter = createArchilStorageBackendAdapter({
        db: dataPlaneDb,
        controlPlaneInternalClient,
        workerConfig,
      });

      await expect(
        storageBackendAdapter.provision({
          organizationId,
          sandboxInstanceId,
        }),
      ).rejects.toThrow();

      const provisionedDiskName = createArchilDiskName({
        sandboxInstanceId,
        ...(archilConfig.namePrefix === undefined ? {} : { namePrefix: archilConfig.namePrefix }),
      });
      const disks = await archil.disks.list();

      expect(disks.some((disk) => disk.name === provisionedDiskName)).toBe(false);
      await expect(
        dataPlaneDb.query.sandboxInstanceStorages.findFirst({
          where: (table, { eq }) => eq(table.sandboxInstanceId, sandboxInstanceId),
        }),
      ).resolves.toBeUndefined();
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "falls back to disk.createToken when createDisk does not return a token",
    async () => {
      if (dbPool === undefined || controlPlaneApi === undefined) {
        throw new Error("Expected integration infrastructure to be initialized.");
      }

      const controlPlaneDb = createControlPlaneDatabase(dbPool);
      const dataPlaneDb = createDataPlaneDataPlaneDatabase(dbPool);
      const controlPlaneInternalClient = new ControlPlaneInternalClient({
        baseUrl: controlPlaneApi.baseUrl,
        internalAuthServiceToken: InternalAuthServiceToken,
      });
      const organizationId = `org_pr4_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
      const sandboxInstanceId = createSandboxInstanceId(
        randomUUID().replaceAll("-", "").slice(0, 12),
      );
      const workerConfig = createWorkerConfig(archilEnvironment);
      const archilConfig = workerConfig.sandboxStorage?.archil;

      if (archilConfig === undefined) {
        throw new Error("Expected managed Archil worker config to be defined.");
      }

      await controlPlaneDb.insert(organizations).values({
        id: organizationId,
        slug: `org-pr4-${randomUUID().replaceAll("-", "").slice(0, 12)}`,
        name: "PR4 integration organization",
      });
      await insertInitialOrganizationCredentialKey({
        db: controlPlaneDb,
        organizationId,
      });
      await controlPlaneDb.insert(organizationSandboxStorageSettings).values({
        organizationId,
        persistentSandboxesEnabled: true,
        storageConfigSource: SandboxStorageConfigSources.MANAGED,
      });

      await ensureSandboxInstance(
        {
          db: dataPlaneDb,
          runtimeProvider: "e2b",
        },
        {
          sandboxInstanceId,
          organizationId,
          sandboxProfileId: "sbp_pr4_integration",
          sandboxProfileVersion: 1,
          persistenceMode: SandboxInstancePersistenceModes.PERSISTENT,
          startedBy: {
            kind: "system",
            id: "worker_pr4_integration",
          },
          source: "dashboard",
        },
      );

      const storageBackendAdapter = createArchilStorageBackendAdapter({
        db: dataPlaneDb,
        controlPlaneInternalClient,
        workerConfig,
      });

      const precreatedDisk = await archil.disks.create(
        createArchilDiskRequest({
          sandboxInstanceId,
          profile: {
            apiKey: archilConfig.apiKey,
            region: archilConfig.region,
            ...(archilConfig.namePrefix === undefined
              ? {}
              : { namePrefix: archilConfig.namePrefix }),
            mounts: [
              {
                type: "s3-compatible",
                bucket: archilEnvironment.MISTLE_TEST_ARCHIL_S3_BUCKET,
                endpoint: archilEnvironment.MISTLE_TEST_ARCHIL_S3_ENDPOINT,
                accessKeyId: archilEnvironment.MISTLE_TEST_ARCHIL_S3_ACCESS_KEY_ID,
                secretAccessKey: archilEnvironment.MISTLE_TEST_ARCHIL_S3_SECRET_ACCESS_KEY,
              },
            ],
          },
        }),
      );
      createdDiskIds.add(precreatedDisk.disk.id);

      if (precreatedDisk.tokenIdentifier === null) {
        throw new Error("Expected precreated Archil disk token identifier.");
      }

      await precreatedDisk.disk.removeTokenUser(precreatedDisk.tokenIdentifier);

      const provisionedStorage = await storageBackendAdapter.provision({
        organizationId,
        sandboxInstanceId,
      });

      expect(provisionedStorage.handle).toBe(precreatedDisk.disk.id);

      const persistedStorage = await requireSandboxStorageRow({
        db: dataPlaneDb,
        sandboxInstanceId,
      });
      expect(persistedStorage.credentialCiphertext).not.toBeNull();
      expect(persistedStorage.credentialNonce).not.toBeNull();
      expect(persistedStorage.organizationCredentialKeyVersion).not.toBeNull();

      if (
        persistedStorage.credentialCiphertext === null ||
        persistedStorage.credentialNonce === null ||
        persistedStorage.organizationCredentialKeyVersion === null
      ) {
        throw new Error("Expected persisted Archil credential fields.");
      }

      const decryptedCredential = await controlPlaneInternalClient.resolveStorageCredential({
        organizationId,
        credentialKind: "disk_token",
        ciphertext: persistedStorage.credentialCiphertext,
        nonce: persistedStorage.credentialNonce,
        organizationCredentialKeyVersion: persistedStorage.organizationCredentialKeyVersion,
      });

      expect(decryptedCredential.plaintext).not.toBe("");

      const diskAfterProvision = await archil.disks.get(provisionedStorage.handle);
      const tokenUsers = diskAfterProvision.authorizedUsers?.filter(
        (user) => user.type === "token",
      );

      expect(tokenUsers).toHaveLength(1);
      expect(tokenUsers?.[0]?.nickname).toBe(sandboxInstanceId);
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "reconciles an existing sandbox token user before minting the persisted token",
    async () => {
      if (dbPool === undefined || controlPlaneApi === undefined) {
        throw new Error("Expected integration infrastructure to be initialized.");
      }

      const controlPlaneDb = createControlPlaneDatabase(dbPool);
      const dataPlaneDb = createDataPlaneDataPlaneDatabase(dbPool);
      const controlPlaneInternalClient = new ControlPlaneInternalClient({
        baseUrl: controlPlaneApi.baseUrl,
        internalAuthServiceToken: InternalAuthServiceToken,
      });
      const organizationId = `org_pr4_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
      const sandboxInstanceId = createSandboxInstanceId(
        randomUUID().replaceAll("-", "").slice(0, 12),
      );
      const workerConfig = createWorkerConfig(archilEnvironment);
      const archilConfig = workerConfig.sandboxStorage?.archil;

      if (archilConfig === undefined) {
        throw new Error("Expected managed Archil worker config to be defined.");
      }

      await controlPlaneDb.insert(organizations).values({
        id: organizationId,
        slug: `org-pr4-${randomUUID().replaceAll("-", "").slice(0, 12)}`,
        name: "PR4 integration organization",
      });
      await insertInitialOrganizationCredentialKey({
        db: controlPlaneDb,
        organizationId,
      });
      await controlPlaneDb.insert(organizationSandboxStorageSettings).values({
        organizationId,
        persistentSandboxesEnabled: true,
        storageConfigSource: SandboxStorageConfigSources.MANAGED,
      });

      await ensureSandboxInstance(
        {
          db: dataPlaneDb,
          runtimeProvider: "e2b",
        },
        {
          sandboxInstanceId,
          organizationId,
          sandboxProfileId: "sbp_pr4_integration",
          sandboxProfileVersion: 1,
          persistenceMode: SandboxInstancePersistenceModes.PERSISTENT,
          startedBy: {
            kind: "system",
            id: "worker_pr4_integration",
          },
          source: "dashboard",
        },
      );

      const storageBackendAdapter = createArchilStorageBackendAdapter({
        db: dataPlaneDb,
        controlPlaneInternalClient,
        workerConfig,
      });

      const precreatedDisk = await archil.disks.create(
        createArchilDiskRequest({
          sandboxInstanceId,
          profile: {
            apiKey: archilConfig.apiKey,
            region: archilConfig.region,
            ...(archilConfig.namePrefix === undefined
              ? {}
              : { namePrefix: archilConfig.namePrefix }),
            mounts: [
              {
                type: "s3-compatible",
                bucket: archilEnvironment.MISTLE_TEST_ARCHIL_S3_BUCKET,
                endpoint: archilEnvironment.MISTLE_TEST_ARCHIL_S3_ENDPOINT,
                accessKeyId: archilEnvironment.MISTLE_TEST_ARCHIL_S3_ACCESS_KEY_ID,
                secretAccessKey: archilEnvironment.MISTLE_TEST_ARCHIL_S3_SECRET_ACCESS_KEY,
              },
            ],
          },
        }),
      );
      createdDiskIds.add(precreatedDisk.disk.id);

      await precreatedDisk.disk.createToken(sandboxInstanceId);

      const provisionedStorage = await storageBackendAdapter.provision({
        organizationId,
        sandboxInstanceId,
      });

      expect(provisionedStorage.handle).toBe(precreatedDisk.disk.id);

      const diskAfterProvision = await archil.disks.get(provisionedStorage.handle);
      const sandboxTokenUsers = diskAfterProvision.authorizedUsers?.filter(
        (user) => user.type === "token" && user.nickname === sandboxInstanceId,
      );

      expect(sandboxTokenUsers).toHaveLength(1);
    },
    IntegrationTestTimeoutMs,
  );
});
