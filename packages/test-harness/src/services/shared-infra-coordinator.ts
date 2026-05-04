import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { systemClock, systemSleeper } from "@mistle/time";
import { getContainerRuntimeClient } from "testcontainers";

import { runCleanupTasks } from "../cleanup/index.js";
import { isIgnorableContainerStopError } from "../docker/cleanup.js";
import {
  MISTLE_TEST_POOLING_ENV,
  MISTLE_TEST_RUN_ID_ENV,
  MISTLE_TEST_RUN_OWNER_PID_ENV,
} from "../environment/runner-pool-session.js";
import { createMailpitInbox, startMailpit, type MailpitService } from "./mailpit/index.js";
import {
  startPostgresWithPgBouncer,
  type PostgresWithPgBouncerService,
  type StartPostgresWithPgBouncerInput,
} from "./postgres/index.js";
import { startSeaweedfsS3, type SeaweedfsS3Service } from "./seaweedfs/index.js";
import { startValkey, type ValkeyService } from "./valkey/index.js";

const STATE_FILE_VERSION = 1;
const LOCK_POLL_INTERVAL_MS = 100;
const LOCK_TIMEOUT_MS = 120_000;
const SHARED_INFRA_KEY_LABEL = "mistle.shared-infra.key";
const SHARED_INFRA_SERVICE_LABEL = "mistle.shared-infra.service";

const SharedInfraRootDirectoryPath = join(tmpdir(), "mistle-test-harness");
const SharedInfraStateFilePath = join(SharedInfraRootDirectoryPath, "shared-infra-state-v1.json");
const SharedInfraLockDirectoryPath = join(
  SharedInfraRootDirectoryPath,
  "shared-infra-state-v1.lock",
);
const SharedInfraLockInfoFilePath = join(SharedInfraLockDirectoryPath, "owner.json");

export const DEFAULT_SHARED_INTEGRATION_INFRA_KEY = "mistle-integration-shared-v1";
const DEFAULT_TEST_ENVIRONMENT_SHARED_INFRA_KEY = "mistle-test-environment";
const SharedInfraDebugEnabled = process.env["MISTLE_SHARED_INFRA_DEBUG"] === "1";

function sharedInfraDebug(message: string): void {
  if (!SharedInfraDebugEnabled) {
    return;
  }
  console.error(`[shared-infra] ${message}`);
}

function formatDuration(milliseconds: number): string {
  return `${(milliseconds / 1000).toFixed(2)}s`;
}

function addTiming(timings: Map<string, number>, label: string, milliseconds: number): void {
  timings.set(label, (timings.get(label) ?? 0) + milliseconds);
}

async function measure<T>(
  timings: Map<string, number>,
  label: string,
  callback: () => Promise<T>,
): Promise<T> {
  const startedAt = systemClock.nowMs();
  try {
    return await callback();
  } finally {
    addTiming(timings, label, systemClock.nowMs() - startedAt);
  }
}

function writeSharedInfraTimingSummary(input: {
  operation: string;
  key: string;
  timings: Map<string, number>;
}): void {
  if (process.env["MISTLE_TEST_TIMING"] !== "1" || input.timings.size === 0) {
    return;
  }

  const phases = [...input.timings.entries()]
    .map(([label, milliseconds]) => `${label}=${formatDuration(milliseconds)}`)
    .join(", ");
  process.stderr.write(
    `[integration-new] shared infra ${input.operation} ${input.key}: ${phases}.\n`,
  );
}

export function createTestEnvironmentSharedInfraKey(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const testRunId = environment[MISTLE_TEST_RUN_ID_ENV];
  if (testRunId === undefined || testRunId.length === 0) {
    return DEFAULT_TEST_ENVIRONMENT_SHARED_INFRA_KEY;
  }

  return `${DEFAULT_TEST_ENVIRONMENT_SHARED_INFRA_KEY}:${testRunId}`;
}

type PostgresRequestConfig = Omit<
  StartPostgresWithPgBouncerInput,
  | "network"
  | "postgresNetworkAlias"
  | "pgbouncerNetworkAlias"
  | "manageProcessCleanup"
  | "containerLabels"
>;

type PersistedPostgresInfra = {
  configFingerprint: string;
  directUrl: string;
  pooledUrl: string;
  postgres: PostgresWithPgBouncerService["postgres"];
  pgbouncer: PostgresWithPgBouncerService["pgbouncer"];
  runtimeMetadata: PostgresWithPgBouncerService["runtimeMetadata"];
};

type PersistedMailpitInfra = {
  smtpHost: string;
  smtpPort: number;
  httpBaseUrl: string;
  runtimeMetadata: MailpitService["runtimeMetadata"];
};

type PersistedSeaweedfsInfra = {
  bucketName: string;
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  runtimeMetadata: SeaweedfsS3Service["runtimeMetadata"];
};

type PersistedValkeyInfra = {
  host: string;
  port: number;
  url: string;
  runtimeMetadata: ValkeyService["runtimeMetadata"];
};

type PersistedLease = {
  ownerPid: number;
  ownerId: string | undefined;
  createdAt: number;
};

type PersistedSharedInfraEntry = {
  postgres: PersistedPostgresInfra | undefined;
  mailpit: PersistedMailpitInfra | undefined;
  seaweedfs: PersistedSeaweedfsInfra | undefined;
  valkey: PersistedValkeyInfra | undefined;
  leases: Record<string, PersistedLease>;
};

type PersistedSharedInfraState = {
  version: number;
  entries: Record<string, PersistedSharedInfraEntry>;
};

type SharedInfraRequest = {
  key: string;
  postgres: PostgresRequestConfig | undefined;
  mailpit: boolean;
  seaweedfs: boolean;
  valkey: boolean;
};

export type SharedInfraCoordinatorLease = {
  infra: {
    postgres: PostgresWithPgBouncerService | undefined;
    mailpit: MailpitService | undefined;
    seaweedfs: SeaweedfsS3Service | undefined;
    valkey: ValkeyService | undefined;
    containerHostGateway: string;
  };
  release: () => Promise<void>;
};

type LeaseOwner = {
  leaseId: string;
  ownerPid: number;
  ownerId: string | undefined;
  runnerOwned: boolean;
};

const TESTCONTAINERS_HOST_GATEWAY = "host.docker.internal";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readRecordString(
  record: Record<string, unknown>,
  key: string,
  label: string,
): string | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string.`);
  }
  return value;
}

function readRecordNumber(
  record: Record<string, unknown>,
  key: string,
  label: string,
): number | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number") {
    throw new Error(`${label} must be a number.`);
  }
  return value;
}

function isProcessAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    if (!isRecord(error)) {
      return false;
    }
    const code = error["code"];
    if (code === "ESRCH") {
      return false;
    }
    if (code === "EPERM") {
      return true;
    }
    return false;
  }
}

function createEmptyState(): PersistedSharedInfraState {
  return {
    version: STATE_FILE_VERSION,
    entries: {},
  };
}

function parsePersistedState(raw: string): PersistedSharedInfraState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Failed to parse shared infra state file: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!isRecord(parsed)) {
    throw new Error("Shared infra state file must contain an object.");
  }

  const version = readRecordNumber(parsed, "version", "shared infra state version");
  if (version !== STATE_FILE_VERSION) {
    throw new Error(
      `Unsupported shared infra state version ${String(version)} (expected ${String(STATE_FILE_VERSION)}).`,
    );
  }

  const entriesValue = parsed["entries"];
  if (!isRecord(entriesValue)) {
    throw new Error("Shared infra state entries must be an object.");
  }

  const entries: Record<string, PersistedSharedInfraEntry> = {};
  for (const [key, value] of Object.entries(entriesValue)) {
    if (!isRecord(value)) {
      throw new Error(`Shared infra state entry ${key} must be an object.`);
    }

    const leasesValue = value["leases"];
    if (!isRecord(leasesValue)) {
      throw new Error(`Shared infra state entry ${key} leases must be an object.`);
    }

    const leases: Record<string, PersistedLease> = {};
    for (const [leaseId, leaseRecordValue] of Object.entries(leasesValue)) {
      if (!isRecord(leaseRecordValue)) {
        throw new Error(`Shared infra lease ${leaseId} in key ${key} must be an object.`);
      }
      const ownerPid = readRecordNumber(
        leaseRecordValue,
        "ownerPid",
        `shared infra lease ${leaseId} ownerPid`,
      );
      const createdAt = readRecordNumber(
        leaseRecordValue,
        "createdAt",
        `shared infra lease ${leaseId} createdAt`,
      );
      if (ownerPid === undefined || createdAt === undefined) {
        throw new Error(`Shared infra lease ${leaseId} in key ${key} is missing required fields.`);
      }
      leases[leaseId] = {
        ownerPid,
        ownerId: readRecordString(
          leaseRecordValue,
          "ownerId",
          `shared infra lease ${leaseId} ownerId`,
        ),
        createdAt,
      };
    }

    const postgresValue = value["postgres"];
    const mailpitValue = value["mailpit"];
    const seaweedfsValue = value["seaweedfs"];
    const valkeyValue = value["valkey"];

    const postgres =
      postgresValue === undefined
        ? undefined
        : (() => {
            if (!isRecord(postgresValue)) {
              throw new Error(`Shared infra postgres entry for key ${key} must be an object.`);
            }
            const configFingerprint = readRecordString(
              postgresValue,
              "configFingerprint",
              `shared infra postgres configFingerprint for key ${key}`,
            );
            const directUrl = readRecordString(
              postgresValue,
              "directUrl",
              `shared infra postgres directUrl for key ${key}`,
            );
            const pooledUrl = readRecordString(
              postgresValue,
              "pooledUrl",
              `shared infra postgres pooledUrl for key ${key}`,
            );
            const postgresData = postgresValue["postgres"];
            const pgbouncerData = postgresValue["pgbouncer"];
            const runtimeMetadata = postgresValue["runtimeMetadata"];
            if (
              configFingerprint === undefined ||
              directUrl === undefined ||
              pooledUrl === undefined ||
              !isRecord(postgresData) ||
              !isRecord(pgbouncerData) ||
              !isRecord(runtimeMetadata)
            ) {
              throw new Error(`Shared infra postgres entry for key ${key} is missing fields.`);
            }

            const postgresHost = readRecordString(
              postgresData,
              "host",
              `shared infra postgres host for key ${key}`,
            );
            const postgresPort = readRecordNumber(
              postgresData,
              "port",
              `shared infra postgres port for key ${key}`,
            );
            const postgresDatabaseName = readRecordString(
              postgresData,
              "databaseName",
              `shared infra postgres databaseName for key ${key}`,
            );
            const postgresUsername = readRecordString(
              postgresData,
              "username",
              `shared infra postgres username for key ${key}`,
            );
            const postgresPassword = readRecordString(
              postgresData,
              "password",
              `shared infra postgres password for key ${key}`,
            );

            const pgbouncerHost = readRecordString(
              pgbouncerData,
              "host",
              `shared infra pgbouncer host for key ${key}`,
            );
            const pgbouncerPort = readRecordNumber(
              pgbouncerData,
              "port",
              `shared infra pgbouncer port for key ${key}`,
            );
            const pgbouncerPoolMode = readRecordString(
              pgbouncerData,
              "poolMode",
              `shared infra pgbouncer poolMode for key ${key}`,
            );
            const pgbouncerDefaultPoolSize = readRecordNumber(
              pgbouncerData,
              "defaultPoolSize",
              `shared infra pgbouncer defaultPoolSize for key ${key}`,
            );
            const pgbouncerMaxClientConnections = readRecordNumber(
              pgbouncerData,
              "maxClientConnections",
              `shared infra pgbouncer maxClientConnections for key ${key}`,
            );

            const postgresContainerId = readRecordString(
              runtimeMetadata,
              "postgresContainerId",
              `shared infra postgres runtime metadata postgresContainerId for key ${key}`,
            );
            const pgbouncerContainerId = readRecordString(
              runtimeMetadata,
              "pgbouncerContainerId",
              `shared infra postgres runtime metadata pgbouncerContainerId for key ${key}`,
            );
            const networkIdValue = runtimeMetadata["networkId"];
            if (
              postgresHost === undefined ||
              postgresPort === undefined ||
              postgresDatabaseName === undefined ||
              postgresUsername === undefined ||
              postgresPassword === undefined ||
              pgbouncerHost === undefined ||
              pgbouncerPort === undefined ||
              pgbouncerPoolMode === undefined ||
              pgbouncerDefaultPoolSize === undefined ||
              pgbouncerMaxClientConnections === undefined ||
              postgresContainerId === undefined ||
              pgbouncerContainerId === undefined
            ) {
              throw new Error(
                `Shared infra postgres entry for key ${key} is missing nested fields.`,
              );
            }

            if (networkIdValue !== undefined && typeof networkIdValue !== "string") {
              throw new Error(
                `Shared infra postgres runtime metadata networkId for key ${key} must be a string when present.`,
              );
            }

            if (
              pgbouncerPoolMode !== "session" &&
              pgbouncerPoolMode !== "transaction" &&
              pgbouncerPoolMode !== "statement"
            ) {
              throw new Error(`Shared infra pgbouncer poolMode for key ${key} is invalid.`);
            }

            return {
              configFingerprint,
              directUrl,
              pooledUrl,
              postgres: {
                host: postgresHost,
                port: postgresPort,
                databaseName: postgresDatabaseName,
                username: postgresUsername,
                password: postgresPassword,
              },
              pgbouncer: {
                host: pgbouncerHost,
                port: pgbouncerPort,
                poolMode: pgbouncerPoolMode,
                defaultPoolSize: pgbouncerDefaultPoolSize,
                maxClientConnections: pgbouncerMaxClientConnections,
              },
              runtimeMetadata: {
                postgresContainerId,
                pgbouncerContainerId,
                networkId: typeof networkIdValue === "string" ? networkIdValue : undefined,
              },
            } satisfies PersistedPostgresInfra;
          })();

    const mailpit =
      mailpitValue === undefined
        ? undefined
        : (() => {
            if (!isRecord(mailpitValue)) {
              throw new Error(`Shared infra mailpit entry for key ${key} must be an object.`);
            }

            const smtpHost = readRecordString(
              mailpitValue,
              "smtpHost",
              `shared infra mailpit smtpHost for key ${key}`,
            );
            const smtpPort = readRecordNumber(
              mailpitValue,
              "smtpPort",
              `shared infra mailpit smtpPort for key ${key}`,
            );
            const httpBaseUrl = readRecordString(
              mailpitValue,
              "httpBaseUrl",
              `shared infra mailpit httpBaseUrl for key ${key}`,
            );
            const runtimeMetadata = mailpitValue["runtimeMetadata"];
            if (
              smtpHost === undefined ||
              smtpPort === undefined ||
              httpBaseUrl === undefined ||
              !isRecord(runtimeMetadata)
            ) {
              throw new Error(`Shared infra mailpit entry for key ${key} is missing fields.`);
            }
            const containerId = readRecordString(
              runtimeMetadata,
              "containerId",
              `shared infra mailpit runtime containerId for key ${key}`,
            );
            if (containerId === undefined) {
              throw new Error(
                `Shared infra mailpit runtime containerId for key ${key} is missing.`,
              );
            }

            return {
              smtpHost,
              smtpPort,
              httpBaseUrl,
              runtimeMetadata: {
                containerId,
              },
            } satisfies PersistedMailpitInfra;
          })();

    const valkey =
      valkeyValue === undefined
        ? undefined
        : (() => {
            if (!isRecord(valkeyValue)) {
              throw new Error(`Shared infra valkey entry for key ${key} must be an object.`);
            }

            const host = readRecordString(
              valkeyValue,
              "host",
              `shared infra valkey host for key ${key}`,
            );
            const port = readRecordNumber(
              valkeyValue,
              "port",
              `shared infra valkey port for key ${key}`,
            );
            const url = readRecordString(
              valkeyValue,
              "url",
              `shared infra valkey url for key ${key}`,
            );
            const runtimeMetadata = valkeyValue["runtimeMetadata"];
            if (
              host === undefined ||
              port === undefined ||
              url === undefined ||
              !isRecord(runtimeMetadata)
            ) {
              throw new Error(`Shared infra valkey entry for key ${key} is missing fields.`);
            }
            const containerId = readRecordString(
              runtimeMetadata,
              "containerId",
              `shared infra valkey runtime containerId for key ${key}`,
            );
            if (containerId === undefined) {
              throw new Error(`Shared infra valkey runtime containerId for key ${key} is missing.`);
            }

            return {
              host,
              port,
              url,
              runtimeMetadata: {
                containerId,
              },
            } satisfies PersistedValkeyInfra;
          })();

    const seaweedfs =
      seaweedfsValue === undefined
        ? undefined
        : (() => {
            if (!isRecord(seaweedfsValue)) {
              throw new Error(`Shared infra seaweedfs entry for key ${key} must be an object.`);
            }

            const bucketName = readRecordString(
              seaweedfsValue,
              "bucketName",
              `shared infra seaweedfs bucketName for key ${key}`,
            );
            const endpoint = readRecordString(
              seaweedfsValue,
              "endpoint",
              `shared infra seaweedfs endpoint for key ${key}`,
            );
            const region = readRecordString(
              seaweedfsValue,
              "region",
              `shared infra seaweedfs region for key ${key}`,
            );
            const accessKeyId = readRecordString(
              seaweedfsValue,
              "accessKeyId",
              `shared infra seaweedfs accessKeyId for key ${key}`,
            );
            const secretAccessKey = readRecordString(
              seaweedfsValue,
              "secretAccessKey",
              `shared infra seaweedfs secretAccessKey for key ${key}`,
            );
            const runtimeMetadata = seaweedfsValue["runtimeMetadata"];
            if (
              bucketName === undefined ||
              endpoint === undefined ||
              region === undefined ||
              accessKeyId === undefined ||
              secretAccessKey === undefined ||
              !isRecord(runtimeMetadata)
            ) {
              throw new Error(`Shared infra seaweedfs entry for key ${key} is missing fields.`);
            }
            const containerId = readRecordString(
              runtimeMetadata,
              "containerId",
              `shared infra seaweedfs runtime containerId for key ${key}`,
            );
            if (containerId === undefined) {
              throw new Error(
                `Shared infra seaweedfs runtime containerId for key ${key} is missing.`,
              );
            }

            return {
              bucketName,
              endpoint,
              region,
              accessKeyId,
              secretAccessKey,
              runtimeMetadata: {
                containerId,
              },
            } satisfies PersistedSeaweedfsInfra;
          })();

    entries[key] = {
      postgres,
      mailpit,
      seaweedfs,
      valkey,
      leases,
    };
  }

  return {
    version: STATE_FILE_VERSION,
    entries,
  };
}

async function readPersistedState(): Promise<PersistedSharedInfraState> {
  try {
    const raw = await readFile(SharedInfraStateFilePath, "utf8");
    return parsePersistedState(raw);
  } catch (error) {
    if (isRecord(error) && error["code"] === "ENOENT") {
      return createEmptyState();
    }
    throw error;
  }
}

async function writePersistedState(state: PersistedSharedInfraState): Promise<void> {
  await mkdir(SharedInfraRootDirectoryPath, { recursive: true });
  await writeJsonFileAtomic(SharedInfraStateFilePath, state);
}

async function writeJsonFileAtomic(filePath: string, value: unknown): Promise<void> {
  const temporaryFilePath = `${filePath}.${process.pid}.${systemClock.nowMs()}.${randomUUID()}.tmp`;
  await writeFile(temporaryFilePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryFilePath, filePath);
}

async function readLockOwnerPid(): Promise<number | undefined> {
  try {
    const raw = await readFile(SharedInfraLockInfoFilePath, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return undefined;
    }
    if (!isRecord(parsed)) {
      return undefined;
    }
    const pid = readRecordNumber(parsed, "pid", "shared infra lock owner pid");
    return pid;
  } catch (error) {
    if (isRecord(error) && error["code"] === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function acquireStateFileLock(): Promise<() => Promise<void>> {
  sharedInfraDebug("lock: ensure root directory");
  await mkdir(SharedInfraRootDirectoryPath, { recursive: true });

  const deadline = systemClock.nowMs() + LOCK_TIMEOUT_MS;
  while (systemClock.nowMs() < deadline) {
    try {
      sharedInfraDebug("lock: creating lock directory");
      await mkdir(SharedInfraLockDirectoryPath);
      sharedInfraDebug("lock: writing lock owner info");
      await writeJsonFileAtomic(SharedInfraLockInfoFilePath, {
        pid: process.pid,
        createdAt: systemClock.nowMs(),
      });
      const cleanupOnProcessExit = (): void => {
        try {
          rmSync(SharedInfraLockDirectoryPath, { recursive: true, force: true });
        } catch {
          // no-op: best effort exit cleanup
        }
      };
      process.once("exit", cleanupOnProcessExit);
      sharedInfraDebug("lock: acquired");
      return async () => {
        process.removeListener("exit", cleanupOnProcessExit);
        sharedInfraDebug("lock: releasing");
        await rm(SharedInfraLockDirectoryPath, { recursive: true, force: true });
      };
    } catch (error) {
      if (!(isRecord(error) && error["code"] === "EEXIST")) {
        throw error;
      }
      const ownerPid = await readLockOwnerPid();
      if (ownerPid !== undefined && !isProcessAlive(ownerPid)) {
        await rm(SharedInfraLockDirectoryPath, { recursive: true, force: true });
        continue;
      }
      sharedInfraDebug("lock: waiting for existing owner");
      await systemSleeper.sleep(LOCK_POLL_INTERVAL_MS);
    }
  }

  throw new Error(
    `Timed out acquiring shared infra state lock after ${String(LOCK_TIMEOUT_MS)}ms.`,
  );
}

async function withStateFileLock<T>(
  callback: () => Promise<T>,
  timings?: Map<string, number>,
): Promise<T> {
  const releaseLock =
    timings === undefined
      ? await acquireStateFileLock()
      : await measure(timings, "state-lock", acquireStateFileLock);
  try {
    sharedInfraDebug("lock: running callback");
    return timings === undefined
      ? await callback()
      : await measure(timings, "state-mutation", callback);
  } finally {
    if (timings === undefined) {
      await releaseLock();
    } else {
      await measure(timings, "state-unlock", releaseLock);
    }
    sharedInfraDebug("lock: released");
  }
}

function createPostgresConfigFingerprint(config: PostgresRequestConfig): string {
  return JSON.stringify(config);
}

function createPostgresServiceView(input: PersistedPostgresInfra): PostgresWithPgBouncerService {
  return {
    directUrl: input.directUrl,
    pooledUrl: input.pooledUrl,
    postgres: input.postgres,
    pgbouncer: input.pgbouncer,
    runtimeMetadata: input.runtimeMetadata,
    stop: async () => {
      throw new Error("Shared postgres infra is coordinator-managed. Use lease.release().");
    },
  };
}

function createMailpitServiceView(input: PersistedMailpitInfra): MailpitService {
  const inbox = createMailpitInbox({
    httpBaseUrl: input.httpBaseUrl,
  });
  return {
    smtpHost: input.smtpHost,
    smtpPort: input.smtpPort,
    httpBaseUrl: input.httpBaseUrl,
    listMessages: inbox.listMessages,
    getMessageSummary: inbox.getMessageSummary,
    waitForMessage: inbox.waitForMessage,
    runtimeMetadata: input.runtimeMetadata,
    stop: async () => {
      throw new Error("Shared mailpit infra is coordinator-managed. Use lease.release().");
    },
  };
}

function createSeaweedfsServiceView(input: PersistedSeaweedfsInfra): SeaweedfsS3Service {
  return {
    bucketName: input.bucketName,
    endpoint: input.endpoint,
    region: input.region,
    accessKeyId: input.accessKeyId,
    secretAccessKey: input.secretAccessKey,
    runtimeMetadata: input.runtimeMetadata,
    stop: async () => {
      throw new Error("Shared seaweedfs infra is coordinator-managed. Use lease.release().");
    },
  };
}

function createValkeyServiceView(input: PersistedValkeyInfra): ValkeyService {
  return {
    host: input.host,
    port: input.port,
    url: input.url,
    runtimeMetadata: input.runtimeMetadata,
    stop: async () => {
      throw new Error("Shared valkey infra is coordinator-managed. Use lease.release().");
    },
  };
}

function isNotFoundError(error: unknown): boolean {
  if (!isRecord(error)) {
    return false;
  }
  const statusCode = error["statusCode"];
  if (typeof statusCode === "number" && statusCode === 404) {
    return true;
  }
  const message = error["message"];
  return typeof message === "string" && message.includes("No such");
}

async function stopContainerById(containerId: string): Promise<void> {
  const runtimeClient = await getContainerRuntimeClient();
  const container = runtimeClient.container.getById(containerId);

  try {
    await runtimeClient.container.stop(container, { timeout: 0 });
  } catch (error) {
    if (!isNotFoundError(error) && !isIgnorableContainerStopError(error)) {
      throw error;
    }
  }

  try {
    await runtimeClient.container.remove(container, { removeVolumes: true });
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }
}

async function removeNetworkById(networkId: string): Promise<void> {
  const runtimeClient = await getContainerRuntimeClient();
  const network = runtimeClient.network.getById(networkId);

  try {
    await runtimeClient.network.remove(network);
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }
}

async function stopPersistedInfraEntry(
  input: PersistedSharedInfraEntry,
  key: string,
): Promise<void> {
  const tasks: Array<() => Promise<void>> = [];

  if (input.mailpit !== undefined) {
    const mailpit = input.mailpit;
    tasks.push(async () => stopContainerById(mailpit.runtimeMetadata.containerId));
  }

  if (input.valkey !== undefined) {
    const valkey = input.valkey;
    tasks.push(async () => stopContainerById(valkey.runtimeMetadata.containerId));
  }

  if (input.seaweedfs !== undefined) {
    const seaweedfs = input.seaweedfs;
    tasks.push(async () => stopContainerById(seaweedfs.runtimeMetadata.containerId));
  }

  if (input.postgres !== undefined) {
    const postgres = input.postgres;
    tasks.push(async () => stopContainerById(postgres.runtimeMetadata.pgbouncerContainerId));
    tasks.push(async () => stopContainerById(postgres.runtimeMetadata.postgresContainerId));
    if (postgres.runtimeMetadata.networkId !== undefined) {
      const networkId = postgres.runtimeMetadata.networkId;
      tasks.push(async () => removeNetworkById(networkId));
    }
  }

  await runCleanupTasks({
    tasks,
    context: `shared infra coordinated cleanup (${key})`,
  });
}

async function cleanupOrphanedLabeledContainers(key: string): Promise<void> {
  const runtimeClient = await getContainerRuntimeClient();
  const containers = await runtimeClient.container.list();
  const tasks: Array<() => Promise<void>> = [];

  for (const container of containers) {
    if (container.Labels[SHARED_INFRA_KEY_LABEL] !== key) {
      continue;
    }
    if (container.Id.length === 0) {
      continue;
    }
    const containerId = container.Id;
    tasks.push(async () => stopContainerById(containerId));
  }

  await runCleanupTasks({
    tasks,
    context: `shared infra orphaned labeled container cleanup (${key})`,
  });
}

function pruneDeadLeases(input: PersistedSharedInfraEntry): void {
  for (const [leaseId, leaseRecord] of Object.entries(input.leases)) {
    if (!isProcessAlive(leaseRecord.ownerPid)) {
      delete input.leases[leaseId];
    }
  }
}

function getOrCreateEntry(
  state: PersistedSharedInfraState,
  key: string,
): PersistedSharedInfraEntry {
  const existing = state.entries[key];
  if (existing !== undefined) {
    return existing;
  }

  const created: PersistedSharedInfraEntry = {
    postgres: undefined,
    mailpit: undefined,
    seaweedfs: undefined,
    valkey: undefined,
    leases: {},
  };
  state.entries[key] = created;
  return created;
}

async function ensureEntryInfraForRequest(
  entry: PersistedSharedInfraEntry,
  request: SharedInfraRequest,
  key: string,
  timings: Map<string, number>,
): Promise<void> {
  const startupCleanupTasks: Array<() => Promise<void>> = [];
  const sharedLabels = {
    [SHARED_INFRA_KEY_LABEL]: key,
  };

  try {
    if (request.postgres !== undefined) {
      const requestedFingerprint = createPostgresConfigFingerprint(request.postgres);
      const existingPostgres = entry.postgres;
      if (existingPostgres !== undefined) {
        if (existingPostgres.configFingerprint !== requestedFingerprint) {
          throw new Error(
            `Shared infra key ${key} was requested with conflicting postgres configuration.`,
          );
        }
      } else {
        sharedInfraDebug(`startup: starting postgres for key=${key}`);
        const postgres = await measure(timings, "start-postgres", async () =>
          startPostgresWithPgBouncer({
            ...request.postgres,
            manageProcessCleanup: false,
            containerLabels: {
              ...sharedLabels,
              [SHARED_INFRA_SERVICE_LABEL]: "postgres",
            },
          }),
        );
        startupCleanupTasks.unshift(async () => postgres.stop());
        sharedInfraDebug(`startup: started postgres for key=${key}`);

        entry.postgres = {
          configFingerprint: requestedFingerprint,
          directUrl: postgres.directUrl,
          pooledUrl: postgres.pooledUrl,
          postgres: postgres.postgres,
          pgbouncer: postgres.pgbouncer,
          runtimeMetadata: postgres.runtimeMetadata,
        };
      }
    }

    if (request.mailpit) {
      if (entry.mailpit === undefined) {
        sharedInfraDebug(`startup: starting mailpit for key=${key}`);
        const mailpit = await measure(timings, "start-mailpit", async () =>
          startMailpit({
            manageProcessCleanup: false,
            containerLabels: {
              ...sharedLabels,
              [SHARED_INFRA_SERVICE_LABEL]: "mailpit",
            },
          }),
        );
        startupCleanupTasks.unshift(async () => mailpit.stop());
        sharedInfraDebug(`startup: started mailpit for key=${key}`);

        entry.mailpit = {
          smtpHost: mailpit.smtpHost,
          smtpPort: mailpit.smtpPort,
          httpBaseUrl: mailpit.httpBaseUrl,
          runtimeMetadata: mailpit.runtimeMetadata,
        };
      }
    }

    if (request.seaweedfs) {
      if (entry.seaweedfs === undefined) {
        sharedInfraDebug(`startup: starting seaweedfs for key=${key}`);
        const seaweedfs = await measure(timings, "start-seaweedfs", async () =>
          startSeaweedfsS3({
            bucketName: "mistle-integration",
            manageProcessCleanup: false,
            containerLabels: {
              ...sharedLabels,
              [SHARED_INFRA_SERVICE_LABEL]: "seaweedfs",
            },
          }),
        );
        startupCleanupTasks.unshift(async () => seaweedfs.stop());
        sharedInfraDebug(`startup: started seaweedfs for key=${key}`);

        entry.seaweedfs = {
          bucketName: seaweedfs.bucketName,
          endpoint: seaweedfs.endpoint,
          region: seaweedfs.region,
          accessKeyId: seaweedfs.accessKeyId,
          secretAccessKey: seaweedfs.secretAccessKey,
          runtimeMetadata: seaweedfs.runtimeMetadata,
        };
      }
    }

    if (request.valkey) {
      if (entry.valkey === undefined) {
        sharedInfraDebug(`startup: starting valkey for key=${key}`);
        const valkey = await measure(timings, "start-valkey", async () =>
          startValkey({
            manageProcessCleanup: false,
            containerLabels: {
              ...sharedLabels,
              [SHARED_INFRA_SERVICE_LABEL]: "valkey",
            },
          }),
        );
        startupCleanupTasks.unshift(async () => valkey.stop());
        sharedInfraDebug(`startup: started valkey for key=${key}`);

        entry.valkey = {
          host: valkey.host,
          port: valkey.port,
          url: valkey.url,
          runtimeMetadata: valkey.runtimeMetadata,
        };
      }
    }
  } catch (error) {
    await runCleanupTasks({
      tasks: startupCleanupTasks,
      context: `shared infra coordinated startup cleanup (${key})`,
    });
    throw error;
  }
}

function validateKey(key: string): void {
  if (key.length === 0) {
    throw new Error("Shared infra key must be a non-empty string.");
  }
}

function resolveLeaseOwner(environment: NodeJS.ProcessEnv): LeaseOwner {
  const testPooling = environment[MISTLE_TEST_POOLING_ENV];
  const testRunId = environment[MISTLE_TEST_RUN_ID_ENV];
  const ownerPidValue = environment[MISTLE_TEST_RUN_OWNER_PID_ENV];

  if (
    testPooling === "1" &&
    testRunId !== undefined &&
    testRunId.length > 0 &&
    ownerPidValue !== undefined &&
    ownerPidValue.length > 0
  ) {
    const ownerPid = Number(ownerPidValue);
    if (!Number.isInteger(ownerPid) || ownerPid <= 0) {
      throw new Error(
        `Expected ${MISTLE_TEST_RUN_OWNER_PID_ENV} to contain a positive integer process id.`,
      );
    }

    const ownerId = createRunnerSharedInfraOwnerId(testRunId);
    return {
      leaseId: ownerId,
      ownerPid,
      ownerId,
      runnerOwned: true,
    };
  }

  return {
    leaseId: randomUUID(),
    ownerPid: process.pid,
    ownerId: undefined,
    runnerOwned: false,
  };
}

function createRunnerSharedInfraOwnerId(testRunId: string): string {
  return `runner:${testRunId}`;
}

export async function acquireSharedInfraCoordinatorLease(
  request: SharedInfraRequest,
): Promise<SharedInfraCoordinatorLease> {
  validateKey(request.key);
  if (request.postgres === undefined && !request.mailpit && !request.seaweedfs && !request.valkey) {
    throw new Error(
      "Shared infra request must require postgres, mailpit, seaweedfs, and/or valkey.",
    );
  }

  const leaseOwner = resolveLeaseOwner(process.env);
  sharedInfraDebug(`lease: acquiring key=${request.key} leaseId=${leaseOwner.leaseId}`);

  const acquireTimings = new Map<string, number>();
  const infraView = await withStateFileLock(async () => {
    sharedInfraDebug(`lease: reading state key=${request.key}`);
    const state = await measure(acquireTimings, "read-state", readPersistedState);
    const entry = getOrCreateEntry(state, request.key);

    await measure(acquireTimings, "prune-dead-leases", async () => {
      pruneDeadLeases(entry);
    });

    if (
      Object.keys(entry.leases).length === 0 &&
      (entry.postgres !== undefined ||
        entry.mailpit !== undefined ||
        entry.seaweedfs !== undefined ||
        entry.valkey !== undefined)
    ) {
      await measure(acquireTimings, "stop-unleased-entry", async () =>
        stopPersistedInfraEntry(entry, request.key),
      );
      entry.postgres = undefined;
      entry.mailpit = undefined;
      entry.seaweedfs = undefined;
      entry.valkey = undefined;
    }
    if (
      Object.keys(entry.leases).length === 0 &&
      entry.postgres === undefined &&
      entry.mailpit === undefined &&
      entry.seaweedfs === undefined &&
      entry.valkey === undefined
    ) {
      await measure(acquireTimings, "cleanup-orphans", async () =>
        cleanupOrphanedLabeledContainers(request.key),
      );
    }

    await measure(acquireTimings, "ensure-infra", async () =>
      ensureEntryInfraForRequest(entry, request, request.key, acquireTimings),
    );
    sharedInfraDebug(`lease: infra ready key=${request.key}`);

    entry.leases[leaseOwner.leaseId] = {
      ownerPid: leaseOwner.ownerPid,
      ownerId: leaseOwner.ownerId,
      createdAt: systemClock.nowMs(),
    };

    await measure(acquireTimings, "write-state", async () => writePersistedState(state));
    sharedInfraDebug(`lease: state persisted key=${request.key}`);

    return {
      postgres:
        entry.postgres === undefined ? undefined : createPostgresServiceView(entry.postgres),
      mailpit: entry.mailpit === undefined ? undefined : createMailpitServiceView(entry.mailpit),
      seaweedfs:
        entry.seaweedfs === undefined ? undefined : createSeaweedfsServiceView(entry.seaweedfs),
      valkey: entry.valkey === undefined ? undefined : createValkeyServiceView(entry.valkey),
      containerHostGateway: TESTCONTAINERS_HOST_GATEWAY,
    };
  }, acquireTimings);
  writeSharedInfraTimingSummary({
    operation: "acquire",
    key: request.key,
    timings: acquireTimings,
  });

  let released = false;

  return {
    infra: infraView,
    release: async () => {
      if (leaseOwner.runnerOwned) {
        return;
      }
      if (released) {
        throw new Error(`Shared infra key ${request.key} lease was already released.`);
      }
      released = true;

      const releaseTimings = new Map<string, number>();
      await withStateFileLock(async () => {
        sharedInfraDebug(`lease: releasing key=${request.key} leaseId=${leaseOwner.leaseId}`);
        const state = await measure(releaseTimings, "read-state", readPersistedState);
        const entry = state.entries[request.key];
        if (entry === undefined) {
          throw new Error(`Shared infra key ${request.key} has no persisted entry during release.`);
        }

        await measure(releaseTimings, "prune-dead-leases", async () => {
          pruneDeadLeases(entry);
        });

        if (entry.leases[leaseOwner.leaseId] === undefined) {
          throw new Error(
            `Shared infra key ${request.key} lease ${leaseOwner.leaseId} was not found during release.`,
          );
        }

        delete entry.leases[leaseOwner.leaseId];

        let stopError: Error | undefined;
        if (Object.keys(entry.leases).length === 0) {
          try {
            await measure(releaseTimings, "stop-entry", async () =>
              stopPersistedInfraEntry(entry, request.key),
            );
          } catch (error) {
            stopError = error instanceof Error ? error : new Error(String(error));
          }
          delete state.entries[request.key];
        }

        await measure(releaseTimings, "write-state", async () => writePersistedState(state));
        sharedInfraDebug(`lease: release persisted key=${request.key}`);

        if (stopError !== undefined) {
          throw stopError;
        }
      }, releaseTimings);
      writeSharedInfraTimingSummary({
        operation: "release",
        key: request.key,
        timings: releaseTimings,
      });
    },
  };
}

export async function stopSharedInfraForTestRun(testRunId: string): Promise<void> {
  if (testRunId.length === 0) {
    throw new Error("Test run id must be non-empty.");
  }

  const ownerId = createRunnerSharedInfraOwnerId(testRunId);
  const cleanupTimings = new Map<string, number>();

  await withStateFileLock(async () => {
    const state = await measure(cleanupTimings, "read-state", readPersistedState);
    const stopErrors: Error[] = [];

    for (const [key, entry] of Object.entries(state.entries)) {
      for (const [leaseId, lease] of Object.entries(entry.leases)) {
        if (lease.ownerId === ownerId) {
          delete entry.leases[leaseId];
        }
      }

      await measure(cleanupTimings, "prune-dead-leases", async () => {
        pruneDeadLeases(entry);
      });

      if (Object.keys(entry.leases).length > 0) {
        continue;
      }

      try {
        await measure(cleanupTimings, `stop-entry:${key}`, async () =>
          stopPersistedInfraEntry(entry, key),
        );
      } catch (error) {
        stopErrors.push(error instanceof Error ? error : new Error(String(error)));
      }
      delete state.entries[key];
    }

    await measure(cleanupTimings, "write-state", async () => writePersistedState(state));

    if (stopErrors.length > 0) {
      throw new AggregateError(
        stopErrors,
        `Failed to stop shared infra for test run ${testRunId}.`,
      );
    }
  }, cleanupTimings);
  writeSharedInfraTimingSummary({
    operation: "cleanup",
    key: testRunId,
    timings: cleanupTimings,
  });
}
