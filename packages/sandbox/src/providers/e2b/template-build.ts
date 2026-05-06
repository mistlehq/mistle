import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { systemClock, systemSleeper } from "@mistle/time";
import { Template, TemplateError, type BuildInfo, type ConnectionOpts, type LogEntry } from "e2b";

import { E2BClientOperationIds, mapE2BClientError } from "./client-errors.js";
import { E2BDefaultTemplateCpuCount, E2BDefaultTemplateMemoryMb } from "./schemas.js";
import {
  E2BTemplateDefaultTag,
  createE2BTemplateAlias,
  createE2BTemplateStartRef,
} from "./template-registry.js";

export type EnsureE2BTemplateAliasInput = {
  baseRef: string;
  connectionOptions: ConnectionOpts;
  cpuCount?: number;
  lockDirectoryPath?: string;
  memoryMb?: number;
  onBuildLogs?: (logEntry: LogEntry) => void;
};

export type EnsureE2BTemplateAliasResult = {
  alias: string;
  templateExists: boolean;
  buildInfo?: BuildInfo;
};

const E2BTemplateAliasLockPollIntervalMs = 1_000;
const E2BTemplateAliasLockTimeoutMs = 30 * 60_000;
const E2BTemplateAliasDuplicateRacePollIntervalMs = 1_000;
const E2BTemplateAliasDuplicateRaceTimeoutMs = 10 * 60_000;

export async function ensureE2BTemplateAlias(
  input: EnsureE2BTemplateAliasInput,
): Promise<EnsureE2BTemplateAliasResult> {
  try {
    const cpuCount = input.cpuCount ?? E2BDefaultTemplateCpuCount;
    const memoryMb = input.memoryMb ?? E2BDefaultTemplateMemoryMb;
    const alias = createE2BTemplateAlias({
      baseRef: input.baseRef,
      cpuCount,
      memoryMb,
    });
    const startRef = createE2BTemplateStartRef(alias);
    const resolveOrBuild = async () =>
      resolveOrBuildE2BTemplateAlias({
        alias,
        startRef,
        baseRef: input.baseRef,
        connectionOptions: input.connectionOptions,
        cpuCount,
        memoryMb,
        ...(input.onBuildLogs === undefined ? {} : { onBuildLogs: input.onBuildLogs }),
      });

    if (input.lockDirectoryPath === undefined) {
      return await resolveOrBuild();
    }

    return await withE2BTemplateAliasLock(
      {
        alias,
        lockRootDirectoryPath: input.lockDirectoryPath,
      },
      resolveOrBuild,
    );
  } catch (error) {
    throw mapE2BClientError(E2BClientOperationIds.RESOLVE_TEMPLATE_ALIAS, error);
  }
}

async function resolveOrBuildE2BTemplateAlias(input: {
  alias: string;
  baseRef: string;
  connectionOptions: ConnectionOpts;
  cpuCount: number;
  memoryMb: number;
  onBuildLogs?: (logEntry: LogEntry) => void;
  startRef: string;
}): Promise<EnsureE2BTemplateAliasResult> {
  const templateExists = await Template.exists(input.alias, input.connectionOptions);

  if (
    templateExists &&
    (await templateHasTag({
      alias: input.alias,
      connectionOptions: input.connectionOptions,
      tag: E2BTemplateDefaultTag,
    }))
  ) {
    return {
      alias: input.startRef,
      templateExists,
    };
  }

  const template = Template().fromImage(input.baseRef);
  let buildInfo: BuildInfo;
  try {
    buildInfo = await Template.build(template, input.startRef, {
      ...input.connectionOptions,
      cpuCount: input.cpuCount,
      memoryMB: input.memoryMb,
      ...(input.onBuildLogs === undefined ? {} : { onBuildLogs: input.onBuildLogs }),
    });
  } catch (error) {
    if (!isE2BTemplateAliasDuplicateRaceError(error)) {
      throw error;
    }

    const aliasBecameReady = await waitForDuplicateCreatedE2BTemplateAlias({
      alias: input.alias,
      connectionOptions: input.connectionOptions,
    });
    if (!aliasBecameReady) {
      throw new Error(
        `E2B template alias '${input.alias}' was created concurrently but did not become ready with tag '${E2BTemplateDefaultTag}' before timeout.`,
        {
          cause: error,
        },
      );
    }

    return {
      alias: input.startRef,
      templateExists: true,
    };
  }

  return {
    alias: input.startRef,
    templateExists,
    buildInfo,
  };
}

export function isE2BTemplateAliasDuplicateRaceError(error: unknown): boolean {
  if (!(error instanceof TemplateError)) {
    return false;
  }

  return (
    error.message.includes("duplicate key value violates unique constraint") &&
    error.message.includes("idx_env_aliases_alias_namespace_unique")
  );
}

async function waitForDuplicateCreatedE2BTemplateAlias(input: {
  alias: string;
  connectionOptions: ConnectionOpts;
}): Promise<boolean> {
  const deadline = systemClock.nowMs() + E2BTemplateAliasDuplicateRaceTimeoutMs;

  while (systemClock.nowMs() < deadline) {
    if (
      (await Template.exists(input.alias, input.connectionOptions)) &&
      (await templateHasTag({
        alias: input.alias,
        connectionOptions: input.connectionOptions,
        tag: E2BTemplateDefaultTag,
      }))
    ) {
      return true;
    }

    await systemSleeper.sleep(E2BTemplateAliasDuplicateRacePollIntervalMs);
  }

  return false;
}

export async function withE2BTemplateAliasLock<T>(
  input: {
    alias: string;
    lockRootDirectoryPath: string;
  },
  callback: () => Promise<T>,
): Promise<T> {
  const lockDirectoryPath = join(input.lockRootDirectoryPath, `${input.alias}.lock`);
  const ownerFilePath = join(lockDirectoryPath, "owner.json");
  const deadline = systemClock.nowMs() + E2BTemplateAliasLockTimeoutMs;

  await mkdir(input.lockRootDirectoryPath, {
    recursive: true,
  });

  while (systemClock.nowMs() < deadline) {
    let acquiredLock = false;
    try {
      await mkdir(lockDirectoryPath);
      acquiredLock = true;
      await writeFile(
        ownerFilePath,
        JSON.stringify({
          pid: process.pid,
          createdAt: systemClock.nowMs(),
          alias: input.alias,
        }),
        "utf8",
      );

      return await callback();
    } catch (error) {
      if (acquiredLock) {
        throw error;
      }

      if (!isNodeErrorCode(error, "EEXIST")) {
        throw error;
      }

      await removeStaleE2BTemplateAliasLock({
        lockDirectoryPath,
        ownerFilePath,
      });
      await systemSleeper.sleep(E2BTemplateAliasLockPollIntervalMs);
    } finally {
      if (acquiredLock) {
        await rm(lockDirectoryPath, {
          recursive: true,
          force: true,
        });
      }
    }
  }

  throw new Error(`Timed out acquiring E2B template alias lock '${lockDirectoryPath}'.`);
}

async function templateHasTag(input: {
  alias: string;
  connectionOptions: ConnectionOpts;
  tag: string;
}): Promise<boolean> {
  const tags = await Template.getTags(input.alias, input.connectionOptions);
  return tags.some((tag) => tag.tag === input.tag);
}

async function removeStaleE2BTemplateAliasLock(input: {
  lockDirectoryPath: string;
  ownerFilePath: string;
}): Promise<void> {
  let rawOwner: string;
  try {
    rawOwner = await readFile(input.ownerFilePath, "utf8");
  } catch (error) {
    if (
      isNodeErrorCode(error, "ENOENT") &&
      (await isLockDirectoryExpired(input.lockDirectoryPath))
    ) {
      await rm(input.lockDirectoryPath, {
        recursive: true,
        force: true,
      });
    }
    return;
  }

  const ownerPid = readLockOwnerPid(rawOwner, input.ownerFilePath);
  if (isProcessAlive(ownerPid)) {
    return;
  }

  await rm(input.lockDirectoryPath, {
    recursive: true,
    force: true,
  });
}

function readLockOwnerPid(rawOwner: string, ownerFilePath: string): number {
  let owner: unknown;
  try {
    owner = JSON.parse(rawOwner);
  } catch (error) {
    throw new Error(`Invalid E2B template alias lock owner '${ownerFilePath}'.`, {
      cause: error,
    });
  }

  if (typeof owner !== "object" || owner === null) {
    throw new Error(`Invalid E2B template alias lock owner '${ownerFilePath}'.`);
  }

  const pid = Reflect.get(owner, "pid");
  if (typeof pid !== "number" || !Number.isInteger(pid)) {
    throw new Error(`Invalid E2B template alias lock owner '${ownerFilePath}'.`);
  }

  return pid;
}

async function isLockDirectoryExpired(lockDirectoryPath: string): Promise<boolean> {
  try {
    const stats = await stat(lockDirectoryPath);
    return stats.mtimeMs + E2BTemplateAliasLockTimeoutMs < systemClock.nowMs();
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      return false;
    }

    throw error;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && Reflect.get(error, "code") === code;
}
