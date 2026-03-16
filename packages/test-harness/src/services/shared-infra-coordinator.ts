import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { systemClock, systemSleeper } from "@mistle/time";
import { getContainerRuntimeClient } from "testcontainers";

import { runCleanupTasks } from "../cleanup/index.js";
import { createMailpitInbox, startMailpit, type MailpitService } from "./mailpit/index.js";
import {
  startPostgresWithPgBouncer,
  type PostgresWithPgBouncerService,
  type StartPostgresWithPgBouncerInput,
} from "./postgres/index.js";

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
const SharedInfraDebugEnabled = process.env["MISTLE_SHARED_INFRA_DEBUG"] === "1";

function sharedInfraDebug(message: string): void {
  if (!SharedInfraDebugEnabled) {
    return;
  }
  console.error(`[shared-infra] ${message}`);
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

type PersistedLease = {
  ownerPid: number;
  createdAt: number;
};

type PersistedSharedInfraEntry = {
  postgres: PersistedPostgresInfra | undefined;
  mailpit: PersistedMailpitInfra | undefined;
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
};

export type SharedInfraCoordinatorLease = {
  infra: {
    postgres: PostgresWithPgBouncerService | undefined;
    mailpit: MailpitService | undefined;
    containerHostGateway: string;
  };
  release: () => Promise<void>;
};

const TESTCONTAINERS_HOST_GATEWAY = "host.docker.internal";

type SharedInfraStateObject = {
  [key: string]: unknown;
};

function isSharedInfraStateObject(value: unknown): value is SharedInfraStateObject {
  return typeof value === "object" && value !== null;
}

function readRecordString(
  record: SharedInfraStateObject,
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
  record: SharedInfraStateObject,
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
    if (!isSharedInfraStateObject(error)) {
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

  if (!isSharedInfraStateObject(parsed)) {
    throw new Error("Shared infra state file must contain an object.");
  }

  const version = readRecordNumber(parsed, "version", "shared infra state version");
  if (version !== STATE_FILE_VERSION) {
    throw new Error(
      `Unsupported shared infra state version ${String(version)} (expected ${String(STATE_FILE_VERSION)}).`,
    );
  }

  const entriesValue = parsed["entries"];
  if (!isSharedInfraStateObject(entriesValue)) {
    throw new Error("Shared infra state entries must be an object.");
  }

  const entries: Record<string, PersistedSharedInfraEntry> = {};
  for (const [key, value] of Object.entries(entriesValue)) {
    if (!isSharedInfraStateObject(value)) {
      throw new Error(`Shared infra state entry ${key} must be an object.`);
    }

    const leasesValue = value["leases"];
    if (!isSharedInfraStateObject(leasesValue)) {
      throw new Error(`Shared infra state entry ${key} leases must be an object.`);
    }

    const leases: Record<string, PersistedLease> = {};
    for (const [leaseId, leaseRecordValue] of Object.entries(leasesValue)) {
      if (!isSharedInfraStateObject(leaseRecordValue)) {
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
        createdAt,
      };
    }

    const postgresValue = value["postgres"];
    const mailpitValue = value["mailpit"];

    const postgres =
      postgresValue === undefined
        ? undefined
        : (() => {
            if (!isSharedInfraStateObject(postgresValue)) {
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
              !isSharedInfraStateObject(postgresData) ||
              !isSharedInfraStateObject(pgbouncerData) ||
              !isSharedInfraStateObject(runtimeMetadata)
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
                networkId: networkIdValue,
              },
            } satisfies PersistedPostgresInfra;
          })();

    const mailpit =
      mailpitValue === undefined
        ? undefined
        : (() => {
            if (!isSharedInfraStateObject(mailpitValue)) {
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
              !isSharedInfraStateObject(runtimeMetadata)
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

    entries[key] = {
      postgres,
      mailpit,
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
    if (isSharedInfraStateObject(error) && error["code"] === "ENOENT") {
      return createEmptyState();
    }
    throw error;
  }
}

async function writePersistedState(state: PersistedSharedInfraState): Promise<void> {
  await mkdir(SharedInfraRootDirectoryPath, { recursive: true });
  await writeFile(SharedInfraStateFilePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
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
    if (!isSharedInfraStateObject(parsed)) {
      return undefined;
    }
    const pid = readRecordNumber(parsed, "pid", "shared infra lock owner pid");
    return pid;
  } catch (error) {
    if (isSharedInfraStateObject(error) && error["code"] === "ENOENT") {
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
      await writeFile(
        SharedInfraLockInfoFilePath,
        `${JSON.stringify({ pid: process.pid, createdAt: systemClock.nowMs() })}\n`,
        "utf8",
      );
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
      if (!(isSharedInfraStateObject(error) && error["code"] === "EEXIST")) {
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

async function withStateFileLock<T>(callback: () => Promise<T>): Promise<T> {
  const releaseLock = await acquireStateFileLock();
  try {
    sharedInfraDebug("lock: running callback");
    return await callback();
  } finally {
    await releaseLock();
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

function isNotFoundError(error: unknown): boolean {
  if (!isSharedInfraStateObject(error)) {
    return false;
  }
  const statusCode = error["statusCode"];
  if (typeof statusCode === "number" && statusCode === 404) {
    return true;
  }
  const message = error["message"];
  return typeof message === "string" && message.includes("No such");
}

function isAlreadyStoppedContainerError(error: unknown): boolean {
  if (!isSharedInfraStateObject(error)) {
    return false;
  }
  const statusCode = error["statusCode"];
  if (typeof statusCode === "number" && statusCode === 304) {
    return true;
  }
  const message = error["message"];
  return typeof message === "string" && message.includes("is not running");
}

async function stopContainerById(containerId: string): Promise<void> {
  const runtimeClient = await getContainerRuntimeClient();
  const container = runtimeClient.container.getById(containerId);

  try {
    await runtimeClient.container.stop(container, { timeout: 0 });
  } catch (error) {
    if (!isNotFoundError(error) && !isAlreadyStoppedContainerError(error)) {
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
    leases: {},
  };
  state.entries[key] = created;
  return created;
}

async function ensureEntryInfraForRequest(
  entry: PersistedSharedInfraEntry,
  request: SharedInfraRequest,
  key: string,
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
        const postgres = await startPostgresWithPgBouncer({
          ...request.postgres,
          manageProcessCleanup: false,
          containerLabels: {
            ...sharedLabels,
            [SHARED_INFRA_SERVICE_LABEL]: "postgres",
          },
        });
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
        const mailpit = await startMailpit({
          manageProcessCleanup: false,
          containerLabels: {
            ...sharedLabels,
            [SHARED_INFRA_SERVICE_LABEL]: "mailpit",
          },
        });
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

export async function acquireSharedInfraCoordinatorLease(
  request: SharedInfraRequest,
): Promise<SharedInfraCoordinatorLease> {
  validateKey(request.key);
  if (request.postgres === undefined && !request.mailpit) {
    throw new Error("Shared infra request must require postgres and/or mailpit.");
  }

  const leaseId = randomUUID();
  sharedInfraDebug(`lease: acquiring key=${request.key} leaseId=${leaseId}`);

  const infraView = await withStateFileLock(async () => {
    sharedInfraDebug(`lease: reading state key=${request.key}`);
    const state = await readPersistedState();
    const entry = getOrCreateEntry(state, request.key);

    pruneDeadLeases(entry);

    if (
      Object.keys(entry.leases).length === 0 &&
      (entry.postgres !== undefined || entry.mailpit !== undefined)
    ) {
      await stopPersistedInfraEntry(entry, request.key);
      entry.postgres = undefined;
      entry.mailpit = undefined;
    }
    if (
      Object.keys(entry.leases).length === 0 &&
      entry.postgres === undefined &&
      entry.mailpit === undefined
    ) {
      await cleanupOrphanedLabeledContainers(request.key);
    }

    await ensureEntryInfraForRequest(entry, request, request.key);
    sharedInfraDebug(`lease: infra ready key=${request.key}`);

    entry.leases[leaseId] = {
      ownerPid: process.pid,
      createdAt: systemClock.nowMs(),
    };

    await writePersistedState(state);
    sharedInfraDebug(`lease: state persisted key=${request.key}`);

    return {
      postgres:
        entry.postgres === undefined ? undefined : createPostgresServiceView(entry.postgres),
      mailpit: entry.mailpit === undefined ? undefined : createMailpitServiceView(entry.mailpit),
      containerHostGateway: TESTCONTAINERS_HOST_GATEWAY,
    };
  });

  let released = false;

  return {
    infra: infraView,
    release: async () => {
      if (released) {
        throw new Error(`Shared infra key ${request.key} lease was already released.`);
      }
      released = true;

      await withStateFileLock(async () => {
        sharedInfraDebug(`lease: releasing key=${request.key} leaseId=${leaseId}`);
        const state = await readPersistedState();
        const entry = state.entries[request.key];
        if (entry === undefined) {
          throw new Error(`Shared infra key ${request.key} has no persisted entry during release.`);
        }

        pruneDeadLeases(entry);

        if (entry.leases[leaseId] === undefined) {
          throw new Error(
            `Shared infra key ${request.key} lease ${leaseId} was not found during release.`,
          );
        }

        delete entry.leases[leaseId];

        let stopError: Error | undefined;
        if (Object.keys(entry.leases).length === 0) {
          try {
            await stopPersistedInfraEntry(entry, request.key);
          } catch (error) {
            stopError = error instanceof Error ? error : new Error(String(error));
          }
          delete state.entries[request.key];
        }

        await writePersistedState(state);
        sharedInfraDebug(`lease: release persisted key=${request.key}`);

        if (stopError !== undefined) {
          throw stopError;
        }
      });
    },
  };
}
