import { randomInt, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { systemClock, systemSleeper } from "@mistle/time";

import { registerProcessCleanupTask } from "../cleanup/index.js";

const StateFileVersion = 1;
const DefaultPortRangeStart = 43_000;
const DefaultPortRangeEnd = 60_999;
const LockPollIntervalMs = 25;
const LockTimeoutMs = 30_000;
const DefaultCoordinatorDir = join(tmpdir(), "mistle-test-harness", "ports");

type PortLease = {
  version: number;
  host: string;
  port: number;
  ownerPid: number;
  createdAt: number;
};

type PortRange = {
  start: number;
  end: number;
};

const LeaseCleanupByPath = new Map<string, () => void>();

export async function reserveAvailablePort(input: {
  host: string;
  coordinatorDir?: string;
  range?: PortRange;
}): Promise<number> {
  const coordinatorDir = input.coordinatorDir ?? DefaultCoordinatorDir;
  const range = input.range ?? {
    start: DefaultPortRangeStart,
    end: DefaultPortRangeEnd,
  };

  validatePortRange(range);

  return withPortAllocationLock(coordinatorDir, async () => {
    await removeStaleLeases({
      coordinatorDir,
      host: input.host,
    });

    const port = await allocatePort({
      coordinatorDir,
      host: input.host,
      range,
    });
    registerLeaseCleanup({
      coordinatorDir,
      host: input.host,
      port,
    });

    return port;
  });
}

export async function releaseReservedPort(input: {
  host: string;
  port: number;
  coordinatorDir?: string;
}): Promise<void> {
  const coordinatorDir = input.coordinatorDir ?? DefaultCoordinatorDir;
  const leaseFilePath = resolveLeaseFilePath({
    coordinatorDir,
    host: input.host,
    port: input.port,
  });
  const lease = await readLease(leaseFilePath);
  if (lease === undefined || lease.ownerPid !== process.pid) {
    return;
  }

  const unregisterCleanup = LeaseCleanupByPath.get(leaseFilePath);
  unregisterCleanup?.();
  LeaseCleanupByPath.delete(leaseFilePath);

  await rm(leaseFilePath, {
    force: true,
  });
}

async function allocatePort(input: {
  coordinatorDir: string;
  host: string;
  range: PortRange;
}): Promise<number> {
  const portCount = input.range.end - input.range.start + 1;
  const offset = randomInt(portCount);

  for (let index = 0; index < portCount; index += 1) {
    const port = input.range.start + ((offset + index) % portCount);
    const leaseFilePath = resolveLeaseFilePath({
      coordinatorDir: input.coordinatorDir,
      host: input.host,
      port,
    });
    const existingLease = await readLease(leaseFilePath);

    if (existingLease !== undefined) {
      continue;
    }

    if (!(await canBind(input.host, port))) {
      continue;
    }

    await writeJsonFileAtomic(leaseFilePath, {
      version: StateFileVersion,
      host: input.host,
      port,
      ownerPid: process.pid,
      createdAt: systemClock.nowMs(),
    });

    return port;
  }

  throw new Error(
    `Unable to reserve an available port for host '${input.host}' in range ${String(
      input.range.start,
    )}-${String(input.range.end)}.`,
  );
}

async function canBind(host: string, port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const server = createServer();

    server.once("error", (error) => {
      if (isNodeError(error) && error.code === "EADDRINUSE") {
        resolve(false);
        return;
      }

      reject(error);
    });
    server.listen(port, host, () => {
      server.close((error) => {
        if (error !== undefined) {
          reject(error);
          return;
        }

        resolve(true);
      });
    });
  });
}

async function removeStaleLeases(input: { coordinatorDir: string; host: string }): Promise<void> {
  const entries = await readDirectoryEntries(input.coordinatorDir);

  await Promise.all(
    entries.map(async (entry) => {
      if (!entry.endsWith(".json")) {
        return;
      }

      const leaseFilePath = join(input.coordinatorDir, entry);
      const lease = await readLease(leaseFilePath);
      if (lease === undefined || lease.host !== input.host || isProcessAlive(lease.ownerPid)) {
        return;
      }

      await rm(leaseFilePath, {
        force: true,
      });
    }),
  );
}

async function readDirectoryEntries(directoryPath: string): Promise<readonly string[]> {
  try {
    return await readdir(directoryPath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

async function readLease(leaseFilePath: string): Promise<PortLease | undefined> {
  let raw: string;
  try {
    raw = await readFile(leaseFilePath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  }

  const parsed: unknown = JSON.parse(raw);
  if (!isPortLease(parsed)) {
    throw new Error(`Invalid test port lease file '${leaseFilePath}'.`);
  }

  if (parsed.version !== StateFileVersion) {
    throw new Error(`Unsupported test port lease file version in '${leaseFilePath}'.`);
  }

  return parsed;
}

async function withPortAllocationLock<T>(
  coordinatorDir: string,
  callback: () => Promise<T>,
): Promise<T> {
  await mkdir(coordinatorDir, {
    recursive: true,
  });

  const lockDirectoryPath = join(coordinatorDir, "allocator.lock");
  const lockOwnerFilePath = join(lockDirectoryPath, "owner.json");
  const deadline = systemClock.nowMs() + LockTimeoutMs;

  while (systemClock.nowMs() < deadline) {
    try {
      await mkdir(lockDirectoryPath);
      await writeJsonFileAtomic(lockOwnerFilePath, {
        pid: process.pid,
        createdAt: systemClock.nowMs(),
      });

      try {
        return await callback();
      } finally {
        await rm(lockDirectoryPath, {
          recursive: true,
          force: true,
        });
      }
    } catch (error) {
      if (!isNodeError(error) || error.code !== "EEXIST") {
        throw error;
      }

      await removeStaleLock({
        lockDirectoryPath,
        lockOwnerFilePath,
      });
      await systemSleeper.sleep(LockPollIntervalMs);
    }
  }

  throw new Error(`Timed out acquiring test port allocator lock '${lockDirectoryPath}'.`);
}

async function removeStaleLock(input: {
  lockDirectoryPath: string;
  lockOwnerFilePath: string;
}): Promise<void> {
  let rawOwner: string;
  try {
    rawOwner = await readFile(input.lockOwnerFilePath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      if (await isLockDirectoryExpired(input.lockDirectoryPath)) {
        await rm(input.lockDirectoryPath, {
          recursive: true,
          force: true,
        });
      }
      return;
    }

    throw error;
  }

  const owner: unknown = JSON.parse(rawOwner);
  if (!isLockOwner(owner)) {
    throw new Error(`Invalid test port allocator lock owner '${input.lockOwnerFilePath}'.`);
  }

  if (isProcessAlive(owner.pid)) {
    return;
  }

  await rm(input.lockDirectoryPath, {
    recursive: true,
    force: true,
  });
}

async function isLockDirectoryExpired(lockDirectoryPath: string): Promise<boolean> {
  try {
    const stats = await stat(lockDirectoryPath);
    return stats.mtimeMs + LockTimeoutMs < systemClock.nowMs();
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

function registerLeaseCleanup(input: { coordinatorDir: string; host: string; port: number }): void {
  const leaseFilePath = resolveLeaseFilePath(input);

  const unregisterCleanup = registerProcessCleanupTask(async () => {
    const lease = await readLease(leaseFilePath);
    if (lease === undefined || lease.ownerPid !== process.pid) {
      return;
    }

    await rm(leaseFilePath, {
      force: true,
    });
  });
  LeaseCleanupByPath.set(leaseFilePath, unregisterCleanup);
}

async function writeJsonFileAtomic(filePath: string, value: unknown): Promise<void> {
  const temporaryFilePath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;

  await writeFile(temporaryFilePath, `${JSON.stringify(value)}\n`);
  await rename(temporaryFilePath, filePath);
}

function resolveLeaseFilePath(input: {
  coordinatorDir: string;
  host: string;
  port: number;
}): string {
  return join(input.coordinatorDir, `${normalizeHost(input.host)}-${String(input.port)}.json`);
}

function normalizeHost(host: string): string {
  return host.replaceAll(".", "_").replaceAll(":", "_");
}

function validatePortRange(range: PortRange): void {
  if (!Number.isInteger(range.start) || !Number.isInteger(range.end)) {
    throw new Error("Test port reservation range must use integer ports.");
  }

  if (range.start < 1 || range.end > 65_535 || range.start > range.end) {
    throw new Error(
      `Invalid test port reservation range ${String(range.start)}-${String(range.end)}.`,
    );
  }
}

function isPortLease(value: unknown): value is PortLease {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value["version"] === StateFileVersion &&
    typeof value["host"] === "string" &&
    typeof value["port"] === "number" &&
    typeof value["ownerPid"] === "number" &&
    typeof value["createdAt"] === "number"
  );
}

function isLockOwner(value: unknown): value is { pid: number; createdAt: number } {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value["pid"] === "number" && typeof value["createdAt"] === "number";
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isNodeError(error) && error.code === "EPERM";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}
