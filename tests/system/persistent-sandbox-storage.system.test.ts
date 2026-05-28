/* eslint-disable jest/no-standalone-expect --
 * This suite uses the extended `it` fixture from the shared system-test context.
 */

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

import { Archil } from "@archildata/client/api";
import { resolveLatestPublishedSandboxBaseImageRef } from "@mistle/config";
import {
  createDataPlaneDatabase,
  sandboxInstances,
  sandboxInstanceStorages,
  type SandboxInstanceStatus,
  SandboxStorageProviders,
} from "@mistle/db/data-plane";
import { SandboxInstanceStatuses } from "@mistle/sandbox-lifecycle";
import { readCapturedOtlpRequests } from "@mistle/test-harness";
import { systemClock, systemSleeper } from "@mistle/time";
import { eq } from "drizzle-orm";
import { Sandbox } from "e2b";
import { Pool } from "pg";
import { describe, expect } from "vitest";
import { z } from "zod";

import {
  resumeSandboxInstance,
  runSandboxExecCommandInSandbox,
  stopSandboxInstance,
  type SandboxExecResult,
} from "./helpers/codex-sandbox.js";
import { it, type AuthenticatedSession, type SystemTestFixture } from "./system-test-context.js";

const execFileAsync = promisify(execFile);
const SystemSandboxProvider = {
  DOCKER: "docker",
  E2B: "e2b",
} as const;
type SystemSandboxProvider = (typeof SystemSandboxProvider)[keyof typeof SystemSandboxProvider];

const SandboxStatusPollIntervalMs = 1_000;
const SandboxStatusTimeoutMs = 3 * 60_000;
const ProviderReplacementStatusTimeoutMs = 5 * 60_000;
const ExternalCleanupPollIntervalMs = 1_000;
const ExternalCleanupTimeoutMs = 60_000;
const TracePollIntervalMs = 200;
const TracePollTimeoutMs = 30_000;
const StoragePollIntervalMs = 500;
const StoragePollTimeoutMs = 30_000;
const InvalidWorkspaceRepositoryUrl =
  "https://github.com/mistlehq/this-repository-does-not-exist-for-pr17-system-test.git";

const SandboxInstanceStatusResponseSchema = z.looseObject({
  id: z.string().min(1),
  status: z.enum(SandboxInstanceStatuses),
  connectable: z.boolean(),
  failureCode: z.string().nullable(),
  failureMessage: z.string().nullable(),
});

const StartSandboxInstanceAcceptedResponseSchema = z
  .object({
    status: z.literal("accepted"),
    sandboxInstanceId: z.string().min(1),
    workflowRunId: z.string().min(1),
  })
  .strict();

const OtlpAttributeSchema = z.looseObject({
  key: z.string(),
  value: z.looseObject({
    stringValue: z.string().optional(),
  }),
});

const OtlpSpanSchema = z.looseObject({
  name: z.string().min(1),
  attributes: z.array(OtlpAttributeSchema).optional(),
});

const OtlpScopeSpansSchema = z.looseObject({
  spans: z.array(OtlpSpanSchema).optional(),
});

const OtlpResourceSpansSchema = z.looseObject({
  resource: z
    .looseObject({
      attributes: z.array(OtlpAttributeSchema).optional(),
    })
    .optional(),
  scopeSpans: z.array(OtlpScopeSpansSchema).optional(),
});

const OtlpTraceExportSchema = z.looseObject({
  resourceSpans: z.array(OtlpResourceSpansSchema).optional(),
});

function readRequestedSystemSandboxProvider(): SystemSandboxProvider {
  const rawProvider =
    process.env.MISTLE_TEST_SYSTEM_SANDBOX_PROVIDER ?? SystemSandboxProvider.DOCKER;

  if (rawProvider === SystemSandboxProvider.DOCKER || rawProvider === SystemSandboxProvider.E2B) {
    return rawProvider;
  }

  throw new Error(
    `Unsupported MISTLE_TEST_SYSTEM_SANDBOX_PROVIDER '${rawProvider}'. Expected 'docker' or 'e2b'.`,
  );
}

const requestedSystemSandboxProvider = readRequestedSystemSandboxProvider();
const itForE2B = requestedSystemSandboxProvider === SystemSandboxProvider.E2B ? it : it.skip;
let resolvedSystemSandboxBaseImagePromise: Promise<string> | undefined;

async function resolveSystemSandboxBaseImage(): Promise<string> {
  if (requestedSystemSandboxProvider !== SystemSandboxProvider.E2B) {
    throw new Error("System sandbox base image is only required for the E2B-backed system suite.");
  }

  resolvedSystemSandboxBaseImagePromise ??= resolveLatestPublishedSandboxBaseImageRef();
  const systemSandboxBaseImagePromise = resolvedSystemSandboxBaseImagePromise;

  if (systemSandboxBaseImagePromise === undefined) {
    throw new Error("Expected the E2B system sandbox base image promise to be initialized.");
  }

  return systemSandboxBaseImagePromise;
}

function readStringAttribute(input: {
  attributes: z.infer<typeof OtlpAttributeSchema>[] | undefined;
  key: string;
}): string | undefined {
  const attribute = input.attributes?.find((item) => item.key === input.key);
  return attribute?.value.stringValue;
}

function readArchilEnvironment(): {
  apiKey: string;
  region: string;
  namePrefix: string;
} {
  const apiKey = process.env.MISTLE_TEST_ARCHIL_API_KEY;
  const region =
    process.env.MISTLE_SANDBOX_STORAGE_ARCHIL_REGION ??
    process.env.MISTLE_TEST_ARCHIL_REGION ??
    "gcp-us-central1";

  if (apiKey === undefined || apiKey.trim().length === 0) {
    throw new Error("MISTLE_TEST_ARCHIL_API_KEY is required for Archil-backed system tests.");
  }

  return {
    apiKey,
    region,
    namePrefix: "it-system-",
  };
}

function readE2BEnvironment(): {
  apiKey: string;
  domain: string | undefined;
} {
  const apiKey = process.env.MISTLE_SANDBOX_E2B_API_KEY ?? process.env.E2B_API_KEY;
  if (apiKey === undefined || apiKey.trim().length === 0) {
    throw new Error(
      "MISTLE_SANDBOX_E2B_API_KEY or E2B_API_KEY is required for E2B-backed system tests.",
    );
  }

  const domain = process.env.MISTLE_SANDBOX_E2B_DOMAIN ?? process.env.MISTLE_SANDBOX_E2B_DOMAIN;
  return {
    apiKey,
    domain: domain === undefined || domain.trim().length === 0 ? undefined : domain,
  };
}

function createDataPlaneDb(fixture: SystemTestFixture): {
  pool: Pool;
  db: ReturnType<typeof createDataPlaneDatabase>;
} {
  const pool = new Pool({
    connectionString: fixture.controlPlaneDatabaseUrl,
  });

  return {
    pool,
    db: createDataPlaneDatabase(pool),
  };
}

async function readSandboxStatus(input: {
  fixture: SystemTestFixture;
  authenticatedSession: AuthenticatedSession;
  sandboxInstanceId: string;
}): Promise<z.infer<typeof SandboxInstanceStatusResponseSchema>> {
  const response = await input.fixture.request(
    `/v1/sandbox/instances/${encodeURIComponent(input.sandboxInstanceId)}`,
    {
      headers: {
        cookie: input.authenticatedSession.cookie,
      },
    },
  );
  const responseText = await response.text().catch(() => "");

  if (response.status !== 200) {
    throw new Error(
      `Expected sandbox status response 200 for '${input.sandboxInstanceId}', got ${String(
        response.status,
      )}. Response body: ${responseText}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(responseText);
  } catch (error) {
    throw new Error(
      `Sandbox status response for '${input.sandboxInstanceId}' returned invalid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return SandboxInstanceStatusResponseSchema.parse(parsed);
}

async function waitForPersistedSandboxStatus(input: {
  fixture: SystemTestFixture;
  sandboxInstanceId: string;
  expectedStatus: "running" | "stopped" | "failed";
  timeoutMs?: number;
}): Promise<void> {
  const { pool, db } = createDataPlaneDb(input.fixture);

  try {
    const deadline = systemClock.nowMs() + (input.timeoutMs ?? SandboxStatusTimeoutMs);
    while (systemClock.nowMs() < deadline) {
      const sandboxInstance = await db.query.sandboxInstances.findFirst({
        columns: {
          status: true,
        },
        where: (table, { eq }) => eq(table.id, input.sandboxInstanceId),
      });

      if (sandboxInstance?.status === input.expectedStatus) {
        return;
      }

      await systemSleeper.sleep(SandboxStatusPollIntervalMs);
    }
  } finally {
    await pool.end();
  }

  throw new Error(
    `Timed out waiting for persisted sandbox status '${input.expectedStatus}' for '${input.sandboxInstanceId}'.`,
  );
}

async function waitForSandboxReady(input: {
  fixture: SystemTestFixture;
  authenticatedSession: AuthenticatedSession;
  sandboxInstanceId: string;
}): Promise<void> {
  const deadline = systemClock.nowMs() + SandboxStatusTimeoutMs;
  let lastStatus: z.infer<typeof SandboxInstanceStatusResponseSchema> | null = null;
  let lastRuntimeState: unknown = null;

  while (systemClock.nowMs() < deadline) {
    const status = await readSandboxStatus(input);
    lastStatus = status;
    if (status.status === "failed") {
      throw new Error(
        `Sandbox '${input.sandboxInstanceId}' failed while waiting for readiness: ${
          status.failureMessage ?? "no failure message"
        }`,
      );
    }

    if (status.status === "running" && status.connectable) {
      const runtimeState = await input.fixture.readSandboxRuntimeState(input.sandboxInstanceId);
      lastRuntimeState = runtimeState;
      if (runtimeState.attachment !== null && runtimeState.runtime.ready) {
        return;
      }
    }

    await systemSleeper.sleep(SandboxStatusPollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for sandbox '${input.sandboxInstanceId}' readiness. Last status: ${JSON.stringify(lastStatus)}. Last runtime state: ${JSON.stringify(lastRuntimeState)}`,
  );
}

async function waitForRuntimeStateReady(input: {
  fixture: SystemTestFixture;
  sandboxInstanceId: string;
  timeoutMs?: number;
}): Promise<void> {
  const deadline = systemClock.nowMs() + (input.timeoutMs ?? SandboxStatusTimeoutMs);
  let lastRuntimeState: unknown = null;

  while (systemClock.nowMs() < deadline) {
    const runtimeState = await input.fixture.readSandboxRuntimeState(input.sandboxInstanceId);
    lastRuntimeState = runtimeState;
    if (runtimeState.attachment !== null && runtimeState.runtime.ready) {
      return;
    }

    await systemSleeper.sleep(SandboxStatusPollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for sandbox '${input.sandboxInstanceId}' runtime state readiness. Last runtime state: ${JSON.stringify(lastRuntimeState)}`,
  );
}

async function waitForSandboxStorageDeletion(input: {
  fixture: SystemTestFixture;
  sandboxInstanceId: string;
}): Promise<void> {
  const { pool, db } = createDataPlaneDb(input.fixture);

  try {
    const deadline = systemClock.nowMs() + StoragePollTimeoutMs;
    while (systemClock.nowMs() < deadline) {
      const storage = await db.query.sandboxInstanceStorages.findFirst({
        where: (table, { eq }) => eq(table.sandboxInstanceId, input.sandboxInstanceId),
      });
      if (storage === undefined) {
        return;
      }

      await systemSleeper.sleep(StoragePollIntervalMs);
    }
  } finally {
    await pool.end();
  }

  throw new Error(
    `Timed out waiting for sandbox storage row deletion for '${input.sandboxInstanceId}'.`,
  );
}

async function readSandboxInstanceState(input: {
  fixture: SystemTestFixture;
  sandboxInstanceId: string;
}): Promise<{
  status: SandboxInstanceStatus;
  providerSandboxId: string | null;
  computeGeneration: number;
  failureCode: string | null;
  failureMessage: string | null;
}> {
  const { pool, db } = createDataPlaneDb(input.fixture);

  try {
    const sandboxInstance = await db.query.sandboxInstances.findFirst({
      columns: {
        status: true,
        providerSandboxId: true,
        computeGeneration: true,
        failureCode: true,
        failureMessage: true,
      },
      where: (table, { eq }) => eq(table.id, input.sandboxInstanceId),
    });
    if (sandboxInstance === undefined) {
      throw new Error(`Sandbox instance '${input.sandboxInstanceId}' was not found.`);
    }

    return sandboxInstance;
  } finally {
    await pool.end();
  }
}

async function updateSandboxStorageHandle(input: {
  fixture: SystemTestFixture;
  sandboxInstanceId: string;
  handle: string;
}): Promise<void> {
  const { pool, db } = createDataPlaneDb(input.fixture);

  try {
    await db
      .update(sandboxInstanceStorages)
      .set({
        handle: input.handle,
      })
      .where(eq(sandboxInstanceStorages.sandboxInstanceId, input.sandboxInstanceId));
  } finally {
    await pool.end();
  }
}

async function readSandboxStorage(input: {
  fixture: SystemTestFixture;
  sandboxInstanceId: string;
}): Promise<{
  provider: "archil" | "docker_volume";
  handle: string;
  region: string | null;
} | null> {
  const { pool, db } = createDataPlaneDb(input.fixture);

  try {
    const sandboxStorage = await db.query.sandboxInstanceStorages.findFirst({
      columns: {
        provider: true,
        handle: true,
        region: true,
      },
      where: (table, { eq }) => eq(table.sandboxInstanceId, input.sandboxInstanceId),
    });

    return sandboxStorage ?? null;
  } finally {
    await pool.end();
  }
}

async function runSandboxShellCommand(input: {
  fixture: SystemTestFixture;
  authenticatedSession: AuthenticatedSession;
  sandboxInstanceId: string;
  command: string;
}): Promise<SandboxExecResult> {
  if (input.fixture.sandboxProvider === SystemSandboxProvider.E2B) {
    const sandboxInstanceState = await readSandboxInstanceState({
      fixture: input.fixture,
      sandboxInstanceId: input.sandboxInstanceId,
    });
    if (sandboxInstanceState.providerSandboxId === null) {
      throw new Error(
        `Expected sandbox '${input.sandboxInstanceId}' to have a provider sandbox id before E2B exec.`,
      );
    }

    const e2bEnvironment = readE2BEnvironment();
    const sandbox = await Sandbox.connect(sandboxInstanceState.providerSandboxId, {
      apiKey: e2bEnvironment.apiKey,
      ...(e2bEnvironment.domain === undefined ? {} : { domain: e2bEnvironment.domain }),
    });
    const result = await sandbox.commands.run(
      "printf '%s' \"$MISTLE_SYSTEM_COMMAND\" >/tmp/mistle-system-command.sh && sh /tmp/mistle-system-command.sh",
      {
        user: "root",
        timeoutMs: 120_000,
        envs: {
          MISTLE_SYSTEM_COMMAND: input.command,
        },
      },
    );

    return {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      truncated: false,
    };
  }

  return runSandboxExecCommandInSandbox({
    fixture: input.fixture,
    authenticatedSession: input.authenticatedSession,
    sandboxInstanceId: input.sandboxInstanceId,
    command: "sh",
    args: ["-lc", input.command],
  });
}

async function writeDurableState(input: {
  fixture: SystemTestFixture;
  authenticatedSession: AuthenticatedSession;
  sandboxInstanceId: string;
  marker: string;
}): Promise<void> {
  const command = [
    "mkdir -p /etc/codex",
    `printf '%s' '${input.marker}' > /root/persistent-marker.txt`,
    `printf '%s' '${input.marker}' > /etc/codex/persistent-marker.txt`,
  ].join(" && ");

  const result = await runSandboxShellCommand({
    fixture: input.fixture,
    authenticatedSession: input.authenticatedSession,
    sandboxInstanceId: input.sandboxInstanceId,
    command,
  });

  expect(result.exitCode).toBe(0);
}

async function readDurableState(input: {
  fixture: SystemTestFixture;
  authenticatedSession: AuthenticatedSession;
  sandboxInstanceId: string;
}): Promise<string> {
  const result = await runSandboxShellCommand({
    fixture: input.fixture,
    authenticatedSession: input.authenticatedSession,
    sandboxInstanceId: input.sandboxInstanceId,
    command:
      "cat /root/persistent-marker.txt && printf '\\n' && cat /etc/codex/persistent-marker.txt",
  });

  expect(result.exitCode).toBe(0);
  return result.stdout.trim();
}

async function assertDurablePathsExposed(input: {
  fixture: SystemTestFixture;
  authenticatedSession: AuthenticatedSession;
  sandboxInstanceId: string;
}): Promise<void> {
  const result = await runSandboxShellCommand({
    fixture: input.fixture,
    authenticatedSession: input.authenticatedSession,
    sandboxInstanceId: input.sandboxInstanceId,
    command: [
      "test -d /root",
      "test -d /etc/codex",
      'root_marker="/root/.mistle-durable-path-check"',
      'codex_marker="/etc/codex/.mistle-durable-path-check"',
      'touch "$root_marker" "$codex_marker"',
      'test -f "$root_marker"',
      'test -f "$codex_marker"',
      'rm -f "$root_marker" "$codex_marker"',
    ].join(" && "),
  });

  expect(result.exitCode).toBe(0);
}

async function deleteProviderCompute(input: {
  provider: SystemSandboxProvider;
  providerSandboxId: string;
}): Promise<void> {
  if (input.provider === SystemSandboxProvider.DOCKER) {
    await execFileAsync("docker", ["rm", "--force", input.providerSandboxId]);
    return;
  }

  const e2bEnvironment = readE2BEnvironment();
  await Sandbox.kill(input.providerSandboxId, {
    apiKey: e2bEnvironment.apiKey,
    ...(e2bEnvironment.domain === undefined ? {} : { domain: e2bEnvironment.domain }),
  });
}

async function tryDeleteProviderCompute(input: {
  provider: SystemSandboxProvider;
  providerSandboxId: string;
}): Promise<void> {
  try {
    await deleteProviderCompute(input);
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
    if (
      message.includes("no such container") ||
      message.includes("sandbox not found") ||
      message.includes("not found")
    ) {
      return;
    }

    throw error;
  }
}

async function waitForProviderComputeDeletion(input: {
  provider: SystemSandboxProvider;
  providerSandboxId: string;
}): Promise<void> {
  const deadline = systemClock.nowMs() + ExternalCleanupTimeoutMs;

  while (systemClock.nowMs() < deadline) {
    if (input.provider === SystemSandboxProvider.DOCKER) {
      try {
        await execFileAsync("docker", ["inspect", input.providerSandboxId]);
      } catch (error) {
        const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
        if (message.includes("no such object") || message.includes("no such container")) {
          return;
        }

        throw error;
      }
    } else {
      const e2bEnvironment = readE2BEnvironment();

      try {
        await Sandbox.getInfo(input.providerSandboxId, {
          apiKey: e2bEnvironment.apiKey,
          ...(e2bEnvironment.domain === undefined ? {} : { domain: e2bEnvironment.domain }),
        });
      } catch (error) {
        const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
        if (message.includes("sandbox not found") || message.includes("not found")) {
          return;
        }

        throw error;
      }
    }

    await systemSleeper.sleep(ExternalCleanupPollIntervalMs);
  }

  throw new Error(`Timed out waiting for provider compute '${input.providerSandboxId}' deletion.`);
}

async function tryDeleteArchilDisk(input: {
  diskId: string;
  region: string | null;
}): Promise<void> {
  const archilEnvironment = readArchilEnvironment();
  const archil = new Archil({
    apiKey: archilEnvironment.apiKey,
    region: input.region ?? archilEnvironment.region,
  });

  try {
    const disk = await archil.disks.get(input.diskId);
    await disk.delete();
  } catch (error) {
    if (isArchilDiskNotFoundError(error)) {
      return;
    }

    throw error;
  }
}

async function waitForArchilDiskDeletion(input: {
  diskId: string;
  region: string | null;
}): Promise<void> {
  const archilEnvironment = readArchilEnvironment();
  const archil = new Archil({
    apiKey: archilEnvironment.apiKey,
    region: input.region ?? archilEnvironment.region,
  });
  const deadline = systemClock.nowMs() + ExternalCleanupTimeoutMs;

  while (systemClock.nowMs() < deadline) {
    try {
      await archil.disks.get(input.diskId);
    } catch (error) {
      if (isArchilDiskNotFoundError(error)) {
        return;
      }

      throw error;
    }

    await systemSleeper.sleep(ExternalCleanupPollIntervalMs);
  }

  throw new Error(`Timed out waiting for Archil disk '${input.diskId}' deletion.`);
}

function isArchilDiskNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "status" in error && error.status === 404;
}

async function tryDeleteDockerVolume(input: { volumeName: string }): Promise<void> {
  try {
    await execFileAsync("docker", ["volume", "rm", "--force", input.volumeName]);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "object" && error !== null && "stderr" in error
          ? String(error.stderr)
          : String(error);
    if (message.includes("No such volume")) {
      return;
    }

    throw error;
  }
}

async function waitForDockerVolumeDeletion(input: { volumeName: string }): Promise<void> {
  const deadline = systemClock.nowMs() + ExternalCleanupTimeoutMs;

  while (systemClock.nowMs() < deadline) {
    try {
      await execFileAsync("docker", ["volume", "inspect", input.volumeName]);
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
      if (message.includes("no such volume")) {
        return;
      }

      throw error;
    }

    await systemSleeper.sleep(ExternalCleanupPollIntervalMs);
  }

  throw new Error(`Timed out waiting for Docker volume '${input.volumeName}' deletion.`);
}

async function cleanupPersistentSandboxes(input: {
  fixture: SystemTestFixture;
  sandboxInstanceIds: readonly string[];
  storageCleanupOverrides?: ReadonlyMap<
    string,
    {
      provider: "archil" | "docker_volume";
      handle: string;
      region: string | null;
    }
  >;
}): Promise<void> {
  const sandboxInstanceIds = [...new Set(input.sandboxInstanceIds)];
  if (sandboxInstanceIds.length === 0) {
    return;
  }

  const errors: Error[] = [];

  for (const sandboxInstanceId of sandboxInstanceIds) {
    const sandboxInstanceState = await readSandboxInstanceState({
      fixture: input.fixture,
      sandboxInstanceId,
    }).catch(() => null);
    const sandboxStorage =
      input.storageCleanupOverrides?.get(sandboxInstanceId) ??
      (await readSandboxStorage({
        fixture: input.fixture,
        sandboxInstanceId,
      }));
    let externalCleanupFailed = false;

    if (sandboxInstanceState?.providerSandboxId !== null && sandboxInstanceState !== null) {
      try {
        await tryDeleteProviderCompute({
          provider: input.fixture.sandboxProvider,
          providerSandboxId: sandboxInstanceState.providerSandboxId,
        });
        await waitForProviderComputeDeletion({
          provider: input.fixture.sandboxProvider,
          providerSandboxId: sandboxInstanceState.providerSandboxId,
        });
      } catch (error) {
        errors.push(
          new Error(`Failed to delete provider compute for '${sandboxInstanceId}'.`, {
            cause: error,
          }),
        );
        externalCleanupFailed = true;
      }
    }

    if (sandboxStorage !== null) {
      try {
        if (sandboxStorage.provider === SandboxStorageProviders.ARCHIL) {
          await tryDeleteArchilDisk({
            diskId: sandboxStorage.handle,
            region: sandboxStorage.region,
          });
          await waitForArchilDiskDeletion({
            diskId: sandboxStorage.handle,
            region: sandboxStorage.region,
          });
        } else if (sandboxStorage.provider === SandboxStorageProviders.DOCKER_VOLUME) {
          await tryDeleteDockerVolume({
            volumeName: sandboxStorage.handle,
          });
          await waitForDockerVolumeDeletion({
            volumeName: sandboxStorage.handle,
          });
        }
      } catch (error) {
        errors.push(
          new Error(`Failed to delete storage backend resource for '${sandboxInstanceId}'.`, {
            cause: error,
          }),
        );
        externalCleanupFailed = true;
      }
    }

    if (externalCleanupFailed) {
      continue;
    }

    const { pool, db } = createDataPlaneDb(input.fixture);
    try {
      await db.delete(sandboxInstances).where(eq(sandboxInstances.id, sandboxInstanceId));
    } catch (error) {
      errors.push(
        new Error(`Failed to delete sandbox instance row for '${sandboxInstanceId}'.`, {
          cause: error,
        }),
      );
    } finally {
      await pool.end();
    }
  }

  if (errors.length === 0) {
    return;
  }

  if (errors.length === 1) {
    throw errors[0];
  }

  throw new AggregateError(errors, "Persistent sandbox system test cleanup failed.");
}

function normalizeCleanupError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error));
}

async function finalizePersistentSandboxTest(input: {
  fixture: SystemTestFixture;
  sandboxInstanceIds: readonly string[];
  testError: unknown;
  storageCleanupOverrides?: ReadonlyMap<
    string,
    {
      provider: "archil" | "docker_volume";
      handle: string;
      region: string | null;
    }
  >;
}): Promise<void> {
  let cleanupError: unknown;

  try {
    await cleanupPersistentSandboxes({
      fixture: input.fixture,
      sandboxInstanceIds: input.sandboxInstanceIds,
      ...(input.storageCleanupOverrides === undefined
        ? {}
        : { storageCleanupOverrides: input.storageCleanupOverrides }),
    });
  } catch (error) {
    cleanupError = error;
  }

  if (input.testError === undefined) {
    if (cleanupError !== undefined) {
      throw cleanupError;
    }

    return;
  }

  if (cleanupError === undefined) {
    throw input.testError;
  }

  throw new Error("Persistent sandbox system test failed and cleanup also failed.", {
    cause: new AggregateError(
      [normalizeCleanupError(input.testError), normalizeCleanupError(cleanupError)],
      "Primary test failure and cleanup failure.",
    ),
  });
}

async function assertArchilDiskAbsent(input: { sandboxInstanceId: string }): Promise<void> {
  const archilEnvironment = readArchilEnvironment();
  const archil = new Archil({
    apiKey: archilEnvironment.apiKey,
    region: archilEnvironment.region,
  });
  const expectedDiskName = `${archilEnvironment.namePrefix}${input.sandboxInstanceId}`;
  const disks = await archil.disks.list();

  const matchingDisk = disks.find((disk) => disk.name === expectedDiskName);
  expect(matchingDisk).toBeUndefined();
}

async function waitForStorageFailureSpan(input: {
  fixture: SystemTestFixture;
  sandboxInstanceId: string;
  operation: "attach" | "deprovision";
}): Promise<void> {
  const deadline = systemClock.nowMs() + TracePollTimeoutMs;

  while (systemClock.nowMs() < deadline) {
    const capturedRequests = await readCapturedOtlpRequests(input.fixture.otlpTraceCaptureFilePath);

    for (const request of capturedRequests) {
      if (request.path !== "/v1/traces") {
        continue;
      }

      const parsedPayload: unknown = JSON.parse(request.body);
      const payload = OtlpTraceExportSchema.parse(parsedPayload);

      for (const resourceSpan of payload.resourceSpans ?? []) {
        const serviceName = readStringAttribute({
          attributes: resourceSpan.resource?.attributes,
          key: "service.name",
        });

        if (serviceName !== "@mistle/data-plane-worker") {
          continue;
        }

        for (const scopeSpan of resourceSpan.scopeSpans ?? []) {
          for (const span of scopeSpan.spans ?? []) {
            if (span.name !== `data_plane_worker.sandbox_storage.${input.operation}`) {
              continue;
            }

            if (
              readStringAttribute({
                attributes: span.attributes,
                key: "mistle.sandbox.instance_id",
              }) !== input.sandboxInstanceId
            ) {
              continue;
            }

            if (
              readStringAttribute({
                attributes: span.attributes,
                key: "mistle.sandbox.storage.failure_code",
              }) === undefined
            ) {
              continue;
            }

            return;
          }
        }
      }
    }

    await systemSleeper.sleep(TracePollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for failing sandbox storage '${input.operation}' telemetry for '${input.sandboxInstanceId}'.`,
  );
}

async function waitForStorageProvisionSuccessSpan(input: {
  fixture: SystemTestFixture;
  sandboxInstanceId: string;
}): Promise<void> {
  const deadline = systemClock.nowMs() + TracePollTimeoutMs;

  while (systemClock.nowMs() < deadline) {
    const capturedRequests = await readCapturedOtlpRequests(input.fixture.otlpTraceCaptureFilePath);

    for (const request of capturedRequests) {
      if (request.path !== "/v1/traces") {
        continue;
      }

      const parsedPayload: unknown = JSON.parse(request.body);
      const payload = OtlpTraceExportSchema.parse(parsedPayload);

      for (const resourceSpan of payload.resourceSpans ?? []) {
        const serviceName = readStringAttribute({
          attributes: resourceSpan.resource?.attributes,
          key: "service.name",
        });

        if (serviceName !== "@mistle/data-plane-worker") {
          continue;
        }

        for (const scopeSpan of resourceSpan.scopeSpans ?? []) {
          for (const span of scopeSpan.spans ?? []) {
            if (span.name !== "data_plane_worker.sandbox_storage.provision") {
              continue;
            }

            if (
              readStringAttribute({
                attributes: span.attributes,
                key: "mistle.sandbox.instance_id",
              }) !== input.sandboxInstanceId
            ) {
              continue;
            }

            if (
              readStringAttribute({
                attributes: span.attributes,
                key: "mistle.sandbox.storage.failure_code",
              }) !== undefined
            ) {
              continue;
            }

            return;
          }
        }
      }
    }

    await systemSleeper.sleep(TracePollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for successful sandbox storage provisioning telemetry for '${input.sandboxInstanceId}'.`,
  );
}

async function startSandboxInstanceInternally(input: {
  fixture: SystemTestFixture;
  authenticatedSession: AuthenticatedSession;
  sandboxProfileId: string;
  sandboxProfileVersion: number;
  runtimePlan: {
    sandboxProfileId: string;
    version: number;
    image: {
      source: "base";
      imageRef: string;
    };
    egressRoutes: [];
    artifacts: [];
    runtimeClients: [];
    workspaceSources: readonly {
      sourceKind: "git-clone";
      resourceKind: "repository";
      path: string;
      originUrl: string;
    }[];
    agentRuntimes: [];
  };
}): Promise<z.infer<typeof StartSandboxInstanceAcceptedResponseSchema>> {
  const systemSandboxBaseImage = await resolveSystemSandboxBaseImage();
  const response = await fetch(`${input.fixture.dataPlaneApiBaseUrl}/internal/sandbox/instances`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-mistle-service-token": input.fixture.internalAuthServiceToken,
    },
    body: JSON.stringify({
      organizationId: input.authenticatedSession.organizationId,
      sandboxProfileId: input.sandboxProfileId,
      sandboxProfileVersion: input.sandboxProfileVersion,
      runtimePlan: input.runtimePlan,
      startedBy: {
        kind: "user",
        id: input.authenticatedSession.userId,
      },
      source: "dashboard",
      image: {
        imageId: systemSandboxBaseImage,
        createdAt: "2026-04-17T00:00:00.000Z",
        kind: "base",
      },
    }),
  });
  const responseText = await response.text().catch(() => "");

  if (response.status !== 200) {
    throw new Error(
      `Expected internal start sandbox status 200, got ${String(response.status)}. Response body: ${responseText}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(responseText);
  } catch (error) {
    throw new Error(
      `Internal start sandbox response returned invalid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return StartSandboxInstanceAcceptedResponseSchema.parse(parsed);
}

async function createRuntimePlan(input: {
  sandboxProfileId: string;
  sandboxProfileVersion: number;
  workspaceSources?: readonly {
    sourceKind: "git-clone";
    resourceKind: "repository";
    path: string;
    originUrl: string;
  }[];
}): Promise<{
  sandboxProfileId: string;
  version: number;
  image: {
    source: "base";
    imageRef: string;
  };
  egressRoutes: [];
  artifacts: [];
  runtimeClients: [];
  workspaceSources: readonly {
    sourceKind: "git-clone";
    resourceKind: "repository";
    path: string;
    originUrl: string;
  }[];
  agentRuntimes: [];
}> {
  const systemSandboxBaseImage = await resolveSystemSandboxBaseImage();

  return {
    sandboxProfileId: input.sandboxProfileId,
    version: input.sandboxProfileVersion,
    image: {
      source: "base",
      imageRef: systemSandboxBaseImage,
    },
    egressRoutes: [],
    artifacts: [],
    runtimeClients: [],
    workspaceSources: input.workspaceSources ?? [],
    agentRuntimes: [],
  };
}

async function preparePersistentSandbox(input: {
  fixture: SystemTestFixture;
  email: string;
}): Promise<{ authenticatedSession: AuthenticatedSession; sandboxInstanceId: string }> {
  const authenticatedSession = await input.fixture.authSession({
    email: input.email,
  });
  await input.fixture.enableManagedPersistentSandboxes({
    cookie: authenticatedSession.cookie,
  });

  const sandboxProfileId = `sbp_persistent_system_${randomUUID().replaceAll("-", "_")}`;
  const startedSandbox = await startSandboxInstanceInternally({
    fixture: input.fixture,
    authenticatedSession,
    sandboxProfileId,
    sandboxProfileVersion: 1,
    runtimePlan: await createRuntimePlan({
      sandboxProfileId,
      sandboxProfileVersion: 1,
    }),
  });
  await waitForSandboxReady({
    fixture: input.fixture,
    authenticatedSession,
    sandboxInstanceId: startedSandbox.sandboxInstanceId,
  });

  return {
    authenticatedSession,
    sandboxInstanceId: startedSandbox.sandboxInstanceId,
  };
}

describe("persistent sandbox storage", () => {
  itForE2B(
    "starts a persistent sandbox with the durable paths exposed",
    async ({ fixture }) => {
      const sandboxInstanceIdsToCleanup: string[] = [];
      let testError: unknown;

      try {
        const { authenticatedSession, sandboxInstanceId } = await preparePersistentSandbox({
          fixture,
          email: `persistent-start-paths-${fixture.sandboxProvider}-${randomUUID()}@example.com`,
        });
        sandboxInstanceIdsToCleanup.push(sandboxInstanceId);

        await assertDurablePathsExposed({
          fixture,
          authenticatedSession,
          sandboxInstanceId,
        });
      } catch (error) {
        testError = error;
      } finally {
        await finalizePersistentSandboxTest({
          fixture,
          sandboxInstanceIds: sandboxInstanceIdsToCleanup,
          testError,
        });
      }
    },
    300_000,
  );

  itForE2B(
    "preserves durable state across stop and resume",
    async ({ fixture }) => {
      const sandboxInstanceIdsToCleanup: string[] = [];
      let testError: unknown;

      try {
        const { authenticatedSession, sandboxInstanceId } = await preparePersistentSandbox({
          fixture,
          email: `persistent-stop-resume-${fixture.sandboxProvider}-${randomUUID()}@example.com`,
        });
        sandboxInstanceIdsToCleanup.push(sandboxInstanceId);
        const marker = `persistent-stop-resume-${randomUUID()}`;

        await writeDurableState({
          fixture,
          authenticatedSession,
          sandboxInstanceId,
          marker,
        });
        const initialContents = await readDurableState({
          fixture,
          authenticatedSession,
          sandboxInstanceId,
        });
        expect(initialContents).toBe([marker, marker].join("\n"));

        await stopSandboxInstance({
          fixture,
          sandboxInstanceId,
        });
        await waitForPersistedSandboxStatus({
          fixture,
          sandboxInstanceId,
          expectedStatus: "stopped",
        });

        await resumeSandboxInstance({
          fixture,
          authenticatedSession,
          sandboxInstanceId,
        });
        await waitForSandboxReady({
          fixture,
          authenticatedSession,
          sandboxInstanceId,
        });

        const resumedContents = await readDurableState({
          fixture,
          authenticatedSession,
          sandboxInstanceId,
        });
        expect(resumedContents).toBe([marker, marker].join("\n"));
      } catch (error) {
        testError = error;
      } finally {
        await finalizePersistentSandboxTest({
          fixture,
          sandboxInstanceIds: sandboxInstanceIdsToCleanup,
          testError,
        });
      }
    },
    300_000,
  );

  itForE2B(
    "preserves durable state across provider compute replacement",
    async ({ fixture }) => {
      const sandboxInstanceIdsToCleanup: string[] = [];
      let testError: unknown;

      try {
        const { authenticatedSession, sandboxInstanceId } = await preparePersistentSandbox({
          fixture,
          email: `persistent-compute-replacement-${fixture.sandboxProvider}-${randomUUID()}@example.com`,
        });
        sandboxInstanceIdsToCleanup.push(sandboxInstanceId);
        const marker = `persistent-compute-replacement-${randomUUID()}`;

        await writeDurableState({
          fixture,
          authenticatedSession,
          sandboxInstanceId,
          marker,
        });

        const originalState = await readSandboxInstanceState({
          fixture,
          sandboxInstanceId,
        });
        if (originalState.providerSandboxId === null) {
          throw new Error(
            `Expected sandbox '${sandboxInstanceId}' to have a provider sandbox id before compute replacement.`,
          );
        }

        await stopSandboxInstance({
          fixture,
          sandboxInstanceId,
        });
        await waitForPersistedSandboxStatus({
          fixture,
          sandboxInstanceId,
          expectedStatus: "stopped",
        });

        await deleteProviderCompute({
          provider: fixture.sandboxProvider,
          providerSandboxId: originalState.providerSandboxId,
        });

        await resumeSandboxInstance({
          fixture,
          authenticatedSession,
          sandboxInstanceId,
        });
        await waitForPersistedSandboxStatus({
          fixture,
          sandboxInstanceId,
          expectedStatus: "running",
          timeoutMs: ProviderReplacementStatusTimeoutMs,
        });
        await waitForRuntimeStateReady({
          fixture,
          sandboxInstanceId,
          timeoutMs: ProviderReplacementStatusTimeoutMs,
        });

        const replacedState = await readSandboxInstanceState({
          fixture,
          sandboxInstanceId,
        });

        expect(replacedState.providerSandboxId).not.toBeNull();
        expect(replacedState.providerSandboxId).not.toBe(originalState.providerSandboxId);
        expect(replacedState.computeGeneration).toBe(originalState.computeGeneration + 1);

        const contents = await readDurableState({
          fixture,
          authenticatedSession,
          sandboxInstanceId,
        });
        expect(contents).toBe([marker, marker].join("\n"));
      } catch (error) {
        testError = error;
      } finally {
        await finalizePersistentSandboxTest({
          fixture,
          sandboxInstanceIds: sandboxInstanceIdsToCleanup,
          testError,
        });
      }
    },
    8 * 60_000,
  );

  itForE2B(
    "surfaces storage attach failure clearly and leaves the sandbox failed",
    async ({ fixture }) => {
      const sandboxInstanceIdsToCleanup: string[] = [];
      const storageCleanupOverrides = new Map<
        string,
        {
          provider: "archil" | "docker_volume";
          handle: string;
          region: string | null;
        }
      >();
      let testError: unknown;

      try {
        const { authenticatedSession, sandboxInstanceId } = await preparePersistentSandbox({
          fixture,
          email: `persistent-attach-failure-${randomUUID()}@example.com`,
        });
        sandboxInstanceIdsToCleanup.push(sandboxInstanceId);
        const originalStorage = await readSandboxStorage({
          fixture,
          sandboxInstanceId,
        });
        if (originalStorage === null) {
          throw new Error(
            `Expected persistent sandbox '${sandboxInstanceId}' to have a storage record before attach-failure mutation.`,
          );
        }
        storageCleanupOverrides.set(sandboxInstanceId, originalStorage);

        await stopSandboxInstance({
          fixture,
          sandboxInstanceId,
        });
        await waitForPersistedSandboxStatus({
          fixture,
          sandboxInstanceId,
          expectedStatus: "stopped",
        });

        await updateSandboxStorageHandle({
          fixture,
          sandboxInstanceId,
          handle: `dsk_missing_${randomUUID().replaceAll("-", "")}`,
        });

        await resumeSandboxInstance({
          fixture,
          authenticatedSession,
          sandboxInstanceId,
        });

        await waitForPersistedSandboxStatus({
          fixture,
          sandboxInstanceId,
          expectedStatus: "failed",
        });
        const failedState = await readSandboxInstanceState({
          fixture,
          sandboxInstanceId,
        });
        expect(failedState.status).toBe("failed");
        expect(failedState.failureMessage).not.toBeNull();

        await waitForStorageFailureSpan({
          fixture,
          sandboxInstanceId,
          operation: "attach",
        });
      } catch (error) {
        testError = error;
      } finally {
        await finalizePersistentSandboxTest({
          fixture,
          sandboxInstanceIds: sandboxInstanceIdsToCleanup,
          testError,
          storageCleanupOverrides,
        });
      }
    },
    300_000,
  );

  itForE2B(
    "cleans up Archil storage after startup fails post-provisioning",
    async ({ fixture }) => {
      const sandboxInstanceIdsToCleanup: string[] = [];
      let testError: unknown;

      try {
        const authenticatedSession = await fixture.authSession({
          email: `persistent-startup-failure-${randomUUID()}@example.com`,
        });
        await fixture.enableManagedPersistentSandboxes({
          cookie: authenticatedSession.cookie,
        });

        const sandboxProfileId = `sbp_startup_failure_${randomUUID().replaceAll("-", "_")}`;
        const startedSandbox = await startSandboxInstanceInternally({
          fixture,
          authenticatedSession,
          sandboxProfileId,
          sandboxProfileVersion: 1,
          runtimePlan: await createRuntimePlan({
            sandboxProfileId,
            sandboxProfileVersion: 1,
            workspaceSources: [
              {
                sourceKind: "git-clone",
                resourceKind: "repository",
                path: "/root/missing-repository",
                originUrl: InvalidWorkspaceRepositoryUrl,
              },
            ],
          }),
        });
        sandboxInstanceIdsToCleanup.push(startedSandbox.sandboxInstanceId);

        await waitForStorageProvisionSuccessSpan({
          fixture,
          sandboxInstanceId: startedSandbox.sandboxInstanceId,
        });
        await waitForPersistedSandboxStatus({
          fixture,
          sandboxInstanceId: startedSandbox.sandboxInstanceId,
          expectedStatus: "failed",
        });
        await waitForSandboxStorageDeletion({
          fixture,
          sandboxInstanceId: startedSandbox.sandboxInstanceId,
        });
        await assertArchilDiskAbsent({
          sandboxInstanceId: startedSandbox.sandboxInstanceId,
        });
      } catch (error) {
        testError = error;
      } finally {
        await finalizePersistentSandboxTest({
          fixture,
          sandboxInstanceIds: sandboxInstanceIdsToCleanup,
          testError,
        });
      }
    },
    300_000,
  );
});
