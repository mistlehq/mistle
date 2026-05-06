import { execFile } from "node:child_process";
import type { Dirent } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { systemClock, systemSleeper } from "@mistle/time";

import type { TestServiceEndpoints, TestServiceRuntime } from "./types.js";

const StateFileVersion = 1;
const LockPollIntervalMs = 50;
const DefaultLockTimeoutMs = 30_000;
const DefaultRunnerPoolRootDirectoryPath = join(tmpdir(), "mistle-test-harness", "runner-pools");
const execFileAsync = promisify(execFile);

export type RunnerServicePoolStartedService = TestServiceRuntime & {
  stop: () => Promise<void>;
};

export type RunnerServicePoolLease = TestServiceRuntime & {
  release: () => Promise<void>;
};

export type AcquireRunnerServicePoolLeaseInput = {
  runId: string;
  key: string;
  start: () => Promise<RunnerServicePoolStartedService>;
  healthCheck: (service: TestServiceRuntime) => Promise<void>;
  coordinatorDir?: string;
  lockTimeoutMs?: number;
};

export type StopRunnerServicePoolsInput = {
  runId: string;
  coordinatorDir?: string;
};

export type CleanupStaleRunnerServicePoolsInput = {
  coordinatorRootDir?: string;
};

type PersistedRunnerService = {
  version: number;
  key: string;
  endpoints: TestServiceEndpoints;
  pid: number | undefined;
  containerId: string | undefined;
  ownerPid: number;
  startedAt: number;
};

const LocalStopCallbacksByStateFilePath = new Map<string, () => Promise<void>>();

export async function acquireRunnerServicePoolLease(
  input: AcquireRunnerServicePoolLeaseInput,
): Promise<RunnerServicePoolLease> {
  const paths = resolveRunnerServicePoolPaths(input);

  return withRunnerServicePoolLock(
    {
      ...paths,
      timeoutMs: input.lockTimeoutMs ?? DefaultLockTimeoutMs,
    },
    async () => {
      const existingService = await readPersistedService(paths.stateFilePath);
      if (
        existingService !== undefined &&
        (await isPersistedServiceHealthy(input, existingService))
      ) {
        return {
          endpoints: existingService.endpoints,
          ...(existingService.pid === undefined ? {} : { pid: existingService.pid }),
          ...(existingService.containerId === undefined
            ? {}
            : { containerId: existingService.containerId }),
          release: async () => {},
        };
      }

      await rm(paths.stateFilePath, {
        force: true,
      });

      const startedService = await input.start();
      const persistedService = {
        version: StateFileVersion,
        key: input.key,
        endpoints: startedService.endpoints,
        pid: startedService.pid,
        containerId: startedService.containerId,
        ownerPid: process.pid,
        startedAt: systemClock.nowMs(),
      };

      await input.healthCheck(startedService);
      await writeJsonFile(paths.stateFilePath, persistedService);
      LocalStopCallbacksByStateFilePath.set(paths.stateFilePath, startedService.stop);

      return {
        endpoints: startedService.endpoints,
        ...(startedService.pid === undefined ? {} : { pid: startedService.pid }),
        ...(startedService.containerId === undefined
          ? {}
          : { containerId: startedService.containerId }),
        release: async () => {},
      };
    },
  );
}

export async function stopRunnerServicePools(input: StopRunnerServicePoolsInput): Promise<void> {
  const rootDirectoryPath = resolveRootDirectoryPath(input);
  const runDirectoryPath = join(rootDirectoryPath, input.runId);
  const stateDirectoryPath = join(runDirectoryPath, "services");

  const entries = await readDirectoryEntries(stateDirectoryPath);
  for (const entry of entries) {
    if (!entry.endsWith(".json")) {
      continue;
    }

    const stateFilePath = join(stateDirectoryPath, entry);
    const persistedService = await readPersistedService(stateFilePath);
    if (persistedService === undefined) {
      continue;
    }

    await stopPersistedService({
      persistedService,
      stateFilePath,
    });

    await rm(stateFilePath, {
      force: true,
    });
  }
}

export async function cleanupStaleRunnerServicePools(
  input: CleanupStaleRunnerServicePoolsInput = {},
): Promise<void> {
  const rootDirectoryPath = input.coordinatorRootDir ?? DefaultRunnerPoolRootDirectoryPath;
  const serviceStateDirectoryPaths = await findRunnerServiceStateDirectories({
    rootDirectoryPath,
    maxDepth: 4,
  });

  for (const serviceStateDirectoryPath of serviceStateDirectoryPaths) {
    const entries = await readDirectoryEntries(serviceStateDirectoryPath);
    for (const entry of entries) {
      if (!entry.endsWith(".json")) {
        continue;
      }

      const stateFilePath = join(serviceStateDirectoryPath, entry);
      const persistedService = await readPersistedService(stateFilePath);
      if (persistedService === undefined || isProcessAlive(persistedService.ownerPid)) {
        continue;
      }

      await stopPersistedService({
        persistedService,
        stateFilePath,
      });
      await rm(stateFilePath, {
        force: true,
      });
    }
  }
}

async function stopPersistedService(input: {
  persistedService: PersistedRunnerService;
  stateFilePath: string;
}): Promise<void> {
  const localStop = LocalStopCallbacksByStateFilePath.get(input.stateFilePath);
  if (localStop !== undefined) {
    await localStop();
    LocalStopCallbacksByStateFilePath.delete(input.stateFilePath);
    return;
  }

  if (input.persistedService.pid !== undefined && isProcessAlive(input.persistedService.pid)) {
    process.kill(input.persistedService.pid, "SIGTERM");
    return;
  }

  if (input.persistedService.containerId !== undefined) {
    await stopContainerById(input.persistedService.containerId);
  }
}

async function stopContainerById(containerId: string): Promise<void> {
  await execFileAsync("docker", ["rm", "-f", containerId]);
}

async function isPersistedServiceHealthy(
  input: AcquireRunnerServicePoolLeaseInput,
  persistedService: PersistedRunnerService,
): Promise<boolean> {
  if (persistedService.pid !== undefined && !isProcessAlive(persistedService.pid)) {
    return false;
  }

  try {
    await input.healthCheck(createRuntimeFromPersisted(persistedService));
    return true;
  } catch {
    return false;
  }
}

function createRuntimeFromPersisted(service: PersistedRunnerService): TestServiceRuntime {
  return {
    endpoints: service.endpoints,
    ...(service.pid === undefined ? {} : { pid: service.pid }),
    ...(service.containerId === undefined ? {} : { containerId: service.containerId }),
  };
}

function resolveRunnerServicePoolPaths(input: {
  runId: string;
  key: string;
  coordinatorDir?: string;
}): {
  lockDirectoryPath: string;
  lockOwnerFilePath: string;
  lockRootDirectoryPath: string;
  stateFilePath: string;
  stateDirectoryPath: string;
} {
  const rootDirectoryPath = resolveRootDirectoryPath(input);
  const runDirectoryPath = join(rootDirectoryPath, input.runId);
  const stateDirectoryPath = join(runDirectoryPath, "services");
  const lockRootDirectoryPath = join(runDirectoryPath, "locks");
  const fileName = encodeURIComponent(input.key);
  const lockDirectoryPath = join(lockRootDirectoryPath, `${fileName}.lock`);

  return {
    lockDirectoryPath,
    lockOwnerFilePath: join(lockDirectoryPath, "owner.json"),
    lockRootDirectoryPath,
    stateFilePath: join(stateDirectoryPath, `${fileName}.json`),
    stateDirectoryPath,
  };
}

function resolveRootDirectoryPath(input: { coordinatorDir?: string }): string {
  return input.coordinatorDir ?? DefaultRunnerPoolRootDirectoryPath;
}

async function withRunnerServicePoolLock<T>(
  paths: {
    lockDirectoryPath: string;
    lockOwnerFilePath: string;
    lockRootDirectoryPath: string;
    stateDirectoryPath: string;
    timeoutMs: number;
  },
  callback: () => Promise<T>,
): Promise<T> {
  await mkdir(paths.stateDirectoryPath, {
    recursive: true,
  });
  await mkdir(paths.lockRootDirectoryPath, {
    recursive: true,
  });

  const deadline = systemClock.nowMs() + paths.timeoutMs;

  while (systemClock.nowMs() < deadline) {
    try {
      await mkdir(paths.lockDirectoryPath);
      await writeJsonFileAtomic(paths.lockOwnerFilePath, {
        pid: process.pid,
        createdAt: systemClock.nowMs(),
      });

      try {
        return await callback();
      } finally {
        await rm(paths.lockDirectoryPath, {
          force: true,
          recursive: true,
        });
      }
    } catch (error) {
      if (!isNodeErrorCode(error, "EEXIST")) {
        throw error;
      }

      if (await isLockOwnerDead(paths.lockOwnerFilePath)) {
        await rm(paths.lockDirectoryPath, {
          force: true,
          recursive: true,
        });
        continue;
      }

      await systemSleeper.sleep(LockPollIntervalMs);
    }
  }

  throw new Error(`Timed out acquiring runner service pool lock '${paths.lockDirectoryPath}'.`);
}

async function isLockOwnerDead(lockOwnerFilePath: string): Promise<boolean> {
  const raw = await readTextFile(lockOwnerFilePath);
  if (raw === undefined) {
    return false;
  }

  const parsed = parseJsonRecord(raw, "runner service pool lock owner");
  const pid = readNumber(parsed, "pid", "runner service pool lock owner pid");
  return !isProcessAlive(pid);
}

async function readPersistedService(
  stateFilePath: string,
): Promise<PersistedRunnerService | undefined> {
  const raw = await readTextFile(stateFilePath);
  if (raw === undefined) {
    return undefined;
  }

  const parsed = parseJsonRecord(raw, "runner service pool state");
  const version = readNumber(parsed, "version", "runner service pool state version");
  if (version !== StateFileVersion) {
    throw new Error(
      `Unsupported runner service pool state version ${String(version)} in '${stateFilePath}'.`,
    );
  }

  const key = readString(parsed, "key", "runner service pool state key");
  const endpoints = readEndpoints(parsed, "runner service pool state endpoints");
  const ownerPid = readNumber(parsed, "ownerPid", "runner service pool state ownerPid");
  const startedAt = readNumber(parsed, "startedAt", "runner service pool state startedAt");
  const pidValue = parsed["pid"];
  const pid =
    pidValue === undefined ? undefined : readNumber(parsed, "pid", "runner service pool state pid");
  const containerIdValue = parsed["containerId"];
  const containerId =
    containerIdValue === undefined
      ? undefined
      : readString(parsed, "containerId", "runner service pool state containerId");

  return {
    version,
    key,
    endpoints,
    pid,
    containerId,
    ownerPid,
    startedAt,
  };
}

function readEndpoints(record: Record<string, unknown>, label: string): TestServiceEndpoints {
  const rawEndpoints = record["endpoints"];
  if (rawEndpoints === undefined) {
    return {};
  }
  if (!isRecord(rawEndpoints)) {
    throw new Error(`${label} must be an object.`);
  }

  const rawHttp = rawEndpoints["http"];
  if (rawHttp === undefined) {
    return {};
  }
  if (!isRecord(rawHttp)) {
    throw new Error(`${label}.http must be an object.`);
  }

  const hostBaseUrl = readString(rawHttp, "hostBaseUrl", `${label}.http.hostBaseUrl`);
  const internalBaseUrlValue = rawHttp["internalBaseUrl"];
  if (internalBaseUrlValue === undefined) {
    return {
      http: {
        hostBaseUrl,
      },
    };
  }
  if (typeof internalBaseUrlValue !== "string") {
    throw new Error(`${label}.http.internalBaseUrl must be a string.`);
  }

  return {
    http: {
      hostBaseUrl,
      internalBaseUrl: internalBaseUrlValue,
    },
  };
}

async function readDirectoryEntries(directoryPath: string): Promise<readonly string[]> {
  try {
    return await readdir(directoryPath);
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      return [];
    }

    throw error;
  }
}

async function findRunnerServiceStateDirectories(input: {
  rootDirectoryPath: string;
  maxDepth: number;
}): Promise<readonly string[]> {
  const directories: string[] = [];
  await collectRunnerServiceStateDirectories({
    directoryPath: input.rootDirectoryPath,
    depth: 0,
    maxDepth: input.maxDepth,
    directories,
  });
  return directories;
}

async function collectRunnerServiceStateDirectories(input: {
  directoryPath: string;
  depth: number;
  maxDepth: number;
  directories: string[];
}): Promise<void> {
  if (input.depth > input.maxDepth) {
    return;
  }

  const entries = await readDirectoryEntriesWithTypes(input.directoryPath);
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const directoryPath = join(input.directoryPath, entry.name);
    if (entry.name === "services") {
      input.directories.push(directoryPath);
      continue;
    }

    await collectRunnerServiceStateDirectories({
      directoryPath,
      depth: input.depth + 1,
      maxDepth: input.maxDepth,
      directories: input.directories,
    });
  }
}

async function readDirectoryEntriesWithTypes(directoryPath: string): Promise<readonly Dirent[]> {
  try {
    return await readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      return [];
    }

    throw error;
  }
}

async function readTextFile(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      return undefined;
    }

    throw error;
  }
}

async function writeJsonFile(filePath: string, value: object): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

async function writeJsonFileAtomic(filePath: string, value: object): Promise<void> {
  const temporaryFilePath = `${filePath}.${process.pid}.tmp`;
  await writeJsonFile(temporaryFilePath, value);
  await rename(temporaryFilePath, filePath);
}

function parseJsonRecord(raw: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Failed to parse ${label}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!isRecord(parsed)) {
    throw new Error(`${label} must be an object.`);
  }

  return parsed;
}

function readString(record: Record<string, unknown>, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string.`);
  }

  return value;
}

function readNumber(record: Record<string, unknown>, key: string, label: string): number {
  const value = record[key];
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return isRecord(error) && error["code"] === code;
}
