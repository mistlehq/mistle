/* eslint-disable jest/expect-expect, jest/no-disabled-tests, no-empty-pattern --
 * This module defines Vitest fixtures instead of declaring test cases. Vitest
 * fixture functions must use object destructuring for the first argument.
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import type { DataPlaneDatabase } from "@mistle/db/data-plane";
import {
  createSandboxAdapter,
  isSandboxResourceNotFoundError,
  SandboxProvider,
  type SandboxAdapter,
} from "@mistle/sandbox";
import { systemClock, systemSleeper } from "@mistle/time";

import { runCleanupTasks, type CleanupTask } from "../cleanup/index.js";
import { MISTLE_TEST_COORDINATOR_DIR_ENV } from "../environment/runner-pool-session.js";
import { createDockerSandboxProviderInfra } from "../environment/service-catalog.js";
import type { TestEnvironment, TestInfraRequirement } from "../environment/types.js";
import { createIntegrationTest, type IntegrationTestEnvironment } from "../integration/index.js";
import { ServiceIds, type ServiceId } from "../integration/services/service-ids.js";
import {
  DockerIntegrationConfigPathInContainer,
  E2BIntegrationConfigPathInContainer,
} from "./integration-config-paths.js";
import { resolveHostPathFromContainerPath } from "./provision-system-integration-targets.js";
import type { RuntimePublicAccessTunnel } from "./runtime-public-access.js";
import { startRuntimeCloudflaredTunnel } from "./runtime-public-access.js";

const execFileAsync = promisify(execFile);
const DefaultBuildContextHostPath = fileURLToPath(new URL("../../../..", import.meta.url));

export type SystemTestServiceSelection =
  | ServiceId
  | {
      service: ServiceId;
      mode: "runtime" | "process";
    };

export type SystemTestExtraInfraId = "mailpit" | "otlp" | "seaweedfs";

export type SystemTestSandboxProvider = "docker" | "e2b";

export type SystemTestSandbox = {
  provider: SystemTestSandboxProvider;
};

export type SystemTestPublicAccess = {
  provider: "cloudflare";
  services: readonly ServiceId[];
};

export type CreateSystemTestInput = {
  services?: readonly SystemTestServiceSelection[];
  extraInfra?: readonly SystemTestExtraInfraId[];
  sandbox?: SystemTestSandbox;
  publicAccess?: SystemTestPublicAccess;
  auth?: {
    google?: "simulated";
  };
};

export type RuntimeSystemTestEnvironment = {
  id: string;
  env: IntegrationTestEnvironment;
  controlPlaneApi: IntegrationTestEnvironment["controlPlaneApi"];
  controlPlaneWorker: IntegrationTestEnvironment["controlPlaneWorker"];
  dataPlaneApi: IntegrationTestEnvironment["dataPlaneApi"];
  dataPlaneGateway: IntegrationTestEnvironment["dataPlaneGateway"];
  dataPlaneWorker: IntegrationTestEnvironment["dataPlaneWorker"];
};

type SystemTestFixture = {
  system: RuntimeSystemTestEnvironment;
};

const DefaultSystemServices: readonly SystemTestServiceSelection[] = [
  ServiceIds.CONTROL_PLANE_API,
  ServiceIds.CONTROL_PLANE_WORKER,
  ServiceIds.DATA_PLANE_API,
  ServiceIds.DATA_PLANE_GATEWAY,
  ServiceIds.DATA_PLANE_WORKER,
];

const DefaultSystemExtraInfra: readonly SystemTestExtraInfraId[] = ["mailpit", "otlp", "seaweedfs"];
const SandboxBaseImageRepository = "ghcr.io/mistlehq/sandbox-base";
const SandboxBaseImagePlatform = "linux/amd64";
const SandboxBaseImageTarget = "sandbox-base-system-tests";
const SandboxBaseImageHashInputs = ["packages/sandboxd"];
const SandboxBaseImageLockPollIntervalMs = 1_000;
const SandboxBaseImageLockTimeoutMs = 30 * 60_000;
const DockerSocketPath = "/var/run/docker.sock";
const PublicAccessHostnameEnvVars = new Map<ServiceId, string>([
  [ServiceIds.CONTROL_PLANE_API, "CONTROL_PLANE_API_TUNNEL_HOSTNAME"],
  [ServiceIds.DATA_PLANE_GATEWAY, "DATA_PLANE_API_TUNNEL_HOSTNAME"],
]);
let systemTestSandboxBaseImageRefPromise: Promise<string> | undefined;

export function createSystemTest(input: CreateSystemTestInput = {}) {
  const base = createIntegrationTest({
    services: input.services ?? DefaultSystemServices,
    extraInfra: input.extraInfra ?? DefaultSystemExtraInfra,
    ...(input.auth === undefined ? {} : { auth: input.auth }),
    ...(input.sandbox === undefined
      ? {}
      : {
          __dangerouslyIsolatedServices: {
            reason:
              "Sandbox runtime system tests keep long-lived bootstrap websockets attached to the data-plane gateway. The gateway must stop and drain per environment before isolated database schemas are dropped.",
            services: [ServiceIds.DATA_PLANE_GATEWAY],
          },
        }),
    __internalInfra: createInternalInfra(input),
    __serviceOptions: async () => createRuntimeSystemServiceOptions(input),
    __afterStart: async ({ environment, integrationEnvironment }) => {
      await syncControlPlaneIntegrationTargets({
        environment: integrationEnvironment,
        configPathInContainer: resolveRuntimeSystemIntegrationConfigPathInContainer(input),
      });
      const cleanupTasks: CleanupTask[] = [];
      const dockerProviderSandboxCleanup = await createDockerProviderSandboxCleanup({
        input,
        environment: integrationEnvironment,
      });
      if (dockerProviderSandboxCleanup !== undefined) {
        cleanupTasks.push(dockerProviderSandboxCleanup);
      }
      const e2bProviderSandboxCleanup = await createE2BProviderSandboxCleanup({
        input,
        environment: integrationEnvironment,
      });
      if (e2bProviderSandboxCleanup !== undefined) {
        cleanupTasks.push(e2bProviderSandboxCleanup);
      }
      const publicAccessTunnel = await startPublicAccess({
        input,
        environment,
      });
      if (publicAccessTunnel !== undefined) {
        cleanupTasks.push(publicAccessTunnel.stop);
      }
      if (cleanupTasks.length === 0) {
        return undefined;
      }

      return async () => {
        await runCleanupTasks({
          tasks: cleanupTasks,
          context: "runtime system test cleanup",
        });
      };
    },
  });

  return base.extend<SystemTestFixture>({
    system: [
      async ({ env }, use) => {
        await use(createRuntimeSystemEnvironment(env));
      },
      {
        scope: "file",
      },
    ],
  });
}

function createInternalInfra(input: CreateSystemTestInput): readonly TestInfraRequirement[] {
  if (input.sandbox === undefined) {
    return [];
  }

  switch (input.sandbox.provider) {
    case "docker":
      return createDockerSandboxProviderInfra();
    case "e2b":
      return [];
  }
}

export async function createRuntimeSystemServiceOptions(input: CreateSystemTestInput): Promise<{
  sandbox?: {
    provider: SystemTestSandboxProvider;
    defaultBaseImageRef?: string;
    e2b?: {
      apiKey: string;
      domain?: string;
      cpuCount?: string;
      memoryMb?: string;
    };
    publicServiceBaseUrls?: ReadonlyMap<ServiceId, string>;
  };
}> {
  if (input.sandbox === undefined) {
    return {};
  }

  if (input.sandbox.provider === "docker") {
    return {
      sandbox: {
        provider: "docker",
      },
    };
  }

  const publicServiceBaseUrls = createPublicServiceBaseUrls(input.publicAccess);
  return {
    sandbox: {
      provider: "e2b",
      defaultBaseImageRef: await getSystemTestSandboxBaseImageRef(),
      e2b: readE2BOptions(),
      publicServiceBaseUrls,
    },
  };
}

function readE2BOptions(): {
  apiKey: string;
  domain?: string;
  cpuCount?: string;
  memoryMb?: string;
  templateLockDirectoryPath: string;
} {
  const apiKey = readRequiredEnv("MISTLE_SANDBOX_E2B_API_KEY");
  const domain = readOptionalEnv("MISTLE_SANDBOX_E2B_DOMAIN");
  const cpuCount = readOptionalEnv("MISTLE_SANDBOX_E2B_CPU_COUNT");
  const memoryMb = readOptionalEnv("MISTLE_SANDBOX_E2B_MEMORY_MB");

  return {
    apiKey,
    ...(domain === undefined ? {} : { domain }),
    ...(cpuCount === undefined ? {} : { cpuCount }),
    ...(memoryMb === undefined ? {} : { memoryMb }),
    templateLockDirectoryPath: join(readTestCoordinatorDirectoryPath(), "e2b-template-aliases"),
  };
}

function readOptionalEnv(envVar: string): string | undefined {
  const value = process.env[envVar];
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }

  return value;
}

function readRequiredEnv(envVar: string): string {
  const value = process.env[envVar];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`Missing required environment variable ${envVar}.`);
  }

  return value;
}

function createPublicServiceBaseUrls(
  publicAccess: SystemTestPublicAccess | undefined,
): ReadonlyMap<ServiceId, string> {
  if (publicAccess === undefined) {
    return new Map();
  }

  return new Map(
    publicAccess.services.map((serviceId) => [
      serviceId,
      `https://${readPublicAccessHostname(serviceId)}`,
    ]),
  );
}

function readPublicAccessHostname(serviceId: ServiceId): string {
  const envVar = PublicAccessHostnameEnvVars.get(serviceId);
  if (envVar === undefined) {
    throw new Error(
      `No Cloudflare public access hostname is configured for service '${serviceId}'.`,
    );
  }

  return readRequiredEnv(envVar);
}

async function createDockerProviderSandboxCleanup(input: {
  input: CreateSystemTestInput;
  environment: IntegrationTestEnvironment;
}): Promise<CleanupTask | undefined> {
  if (input.input.sandbox?.provider !== "docker") {
    return undefined;
  }

  const dataPlaneDb = input.environment.dataPlaneDb;
  const baselineProviderSandboxIds = await listPersistedProviderSandboxIds(dataPlaneDb);
  const sandboxAdapter = createSandboxAdapter({
    provider: SandboxProvider.DOCKER,
    docker: {
      socketPath: DockerSocketPath,
    },
  });

  return async () => {
    const currentProviderSandboxIds = await listPersistedProviderSandboxIds(dataPlaneDb);
    const providerSandboxIds = selectProviderSandboxIdsCreatedByTest({
      baselineProviderSandboxIds,
      currentProviderSandboxIds,
    });

    await Promise.all(
      providerSandboxIds.map(async (providerSandboxId) => {
        await destroyProviderSandboxForRuntimeSystemCleanup({
          sandboxAdapter,
          providerSandboxId,
        });
      }),
    );
  };
}

async function createE2BProviderSandboxCleanup(input: {
  input: CreateSystemTestInput;
  environment: IntegrationTestEnvironment;
}): Promise<CleanupTask | undefined> {
  if (input.input.sandbox?.provider !== "e2b") {
    return undefined;
  }

  const dataPlaneDb = input.environment.dataPlaneDb;
  const baselineProviderSandboxIds = await listPersistedProviderSandboxIds(dataPlaneDb);
  const sandboxAdapter = createSandboxAdapter({
    provider: SandboxProvider.E2B,
    e2b: createE2BSandboxConfig(readE2BOptions()),
  });

  return async () => {
    const currentProviderSandboxIds = await listPersistedProviderSandboxIds(dataPlaneDb);
    const providerSandboxIds = selectProviderSandboxIdsCreatedByTest({
      baselineProviderSandboxIds,
      currentProviderSandboxIds,
    });

    await Promise.all(
      providerSandboxIds.map(async (providerSandboxId) => {
        await destroyProviderSandboxForRuntimeSystemCleanup({
          sandboxAdapter,
          providerSandboxId,
        });
      }),
    );
  };
}

export async function destroyProviderSandboxForRuntimeSystemCleanup(input: {
  sandboxAdapter: SandboxAdapter;
  providerSandboxId: string;
}): Promise<void> {
  try {
    await input.sandboxAdapter.destroy({
      id: input.providerSandboxId,
    });
  } catch (error) {
    if (shouldIgnoreRuntimeSystemProviderSandboxCleanupError(error)) {
      return;
    }

    throw error;
  }
}

export function shouldIgnoreRuntimeSystemProviderSandboxCleanupError(error: unknown): boolean {
  return isSandboxResourceNotFoundError(error);
}

async function listPersistedProviderSandboxIds(
  dataPlaneDb: DataPlaneDatabase,
): Promise<ReadonlySet<string>> {
  const sandboxInstances = await dataPlaneDb.query.sandboxInstances.findMany({
    columns: {
      providerSandboxId: true,
    },
  });

  return new Set(
    sandboxInstances
      .map((sandboxInstance) => sandboxInstance.providerSandboxId)
      .filter((providerSandboxId): providerSandboxId is string => providerSandboxId !== null),
  );
}

export function selectProviderSandboxIdsCreatedByTest(input: {
  baselineProviderSandboxIds: ReadonlySet<string>;
  currentProviderSandboxIds: ReadonlySet<string>;
}): string[] {
  return [...input.currentProviderSandboxIds]
    .filter((providerSandboxId) => !input.baselineProviderSandboxIds.has(providerSandboxId))
    .sort();
}

function createE2BSandboxConfig(input: ReturnType<typeof readE2BOptions>): {
  apiKey: string;
  domain?: string;
  cpuCount?: number;
  memoryMb?: number;
} {
  return {
    apiKey: input.apiKey,
    ...(input.domain === undefined ? {} : { domain: input.domain }),
    ...(input.cpuCount === undefined
      ? {}
      : { cpuCount: parsePositiveIntegerEnvValue("MISTLE_SANDBOX_E2B_CPU_COUNT", input.cpuCount) }),
    ...(input.memoryMb === undefined
      ? {}
      : { memoryMb: parsePositiveIntegerEnvValue("MISTLE_SANDBOX_E2B_MEMORY_MB", input.memoryMb) }),
  };
}

function parsePositiveIntegerEnvValue(envVar: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Expected ${envVar} to be a positive integer.`);
  }

  return parsed;
}

function readRuntimePublicAccessHostnames(): readonly string[] {
  return [...new Set([...PublicAccessHostnameEnvVars.values()].map(readRequiredEnv))].sort();
}

async function startPublicAccess(input: {
  input: CreateSystemTestInput;
  environment: TestEnvironment<ServiceId>;
}): Promise<RuntimePublicAccessTunnel | undefined> {
  if (input.input.publicAccess === undefined) {
    return undefined;
  }

  return startRuntimeCloudflaredTunnel({
    environmentId: input.environment.id,
    tunnelId: readRequiredEnv("CLOUDFLARE_TUNNEL_ID"),
    tunnelCredentialsJson: readRequiredEnv("CLOUDFLARE_TUNNEL_CREDENTIALS_JSON"),
    publicHostnames: readRuntimePublicAccessHostnames(),
    ingressRules: input.input.publicAccess.services.map((serviceId) => {
      const service = input.environment.services.get(serviceId);
      const httpEndpoint = service.endpoints.http;
      if (httpEndpoint === undefined) {
        throw new Error(
          `Service '${serviceId}' does not expose an HTTP endpoint for public access.`,
        );
      }

      return {
        publicHostname: readPublicAccessHostname(serviceId),
        localBaseUrl: httpEndpoint.hostBaseUrl,
        ...(serviceId === ServiceIds.DATA_PLANE_GATEWAY
          ? { upgradeProbePath: "/tunnel/sandbox/sbi_runtime_public_access_probe" }
          : {}),
      };
    }),
  });
}

async function getSystemTestSandboxBaseImageRef(): Promise<string> {
  if (systemTestSandboxBaseImageRefPromise !== undefined) {
    return systemTestSandboxBaseImageRefPromise;
  }

  systemTestSandboxBaseImageRefPromise = resolveSystemTestSandboxBaseImageRef();
  return systemTestSandboxBaseImageRefPromise;
}

async function resolveSystemTestSandboxBaseImageRef(): Promise<string> {
  const tag = `sys-${await createSandboxBaseImageFingerprint()}`;
  const imageRef = `${SandboxBaseImageRepository}:${tag}`;
  if (await ghcrImageExists(imageRef)) {
    return imageRef;
  }

  return withSystemTestSandboxBaseImageLock(tag, async () => {
    if (await ghcrImageExists(imageRef)) {
      return imageRef;
    }

    await runCommand({
      command: "pnpm",
      args: [
        "run",
        "dev:sandbox-base:push:docker",
        "--repository",
        SandboxBaseImageRepository,
        "--platform",
        SandboxBaseImagePlatform,
        "--target",
        SandboxBaseImageTarget,
        "--tag",
        tag,
      ],
      cwd: DefaultBuildContextHostPath,
      env: {},
    });

    return imageRef;
  });
}

async function ghcrImageExists(imageRef: string): Promise<boolean> {
  try {
    await execFileAsync("docker", ["buildx", "imagetools", "inspect", imageRef], {
      cwd: DefaultBuildContextHostPath,
      timeout: 30_000,
      maxBuffer: 1_000_000,
    });
    return true;
  } catch {
    return false;
  }
}

async function createSandboxBaseImageFingerprint(): Promise<string> {
  const trackedFiles = await readTrackedSandboxBaseImageFiles();
  const hash = createHash("sha256");
  hash.update(SandboxBaseImageTarget);
  hash.update("\0");

  for (const filePath of trackedFiles) {
    hash.update(filePath);
    hash.update("\0");
    hash.update(await readFile(new URL(`../../../../${filePath}`, import.meta.url)));
    hash.update("\0");
  }

  return hash.digest("hex").slice(0, 24);
}

async function readTrackedSandboxBaseImageFiles(): Promise<readonly string[]> {
  const { stdout } = await execFileAsync("git", ["ls-files", "--", ...SandboxBaseImageHashInputs], {
    cwd: DefaultBuildContextHostPath,
    encoding: "utf8",
    maxBuffer: 1_000_000,
  });

  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .sort();
}

async function withSystemTestSandboxBaseImageLock<T>(
  tag: string,
  callback: () => Promise<T>,
): Promise<T> {
  const lockRootDirectoryPath = join(readTestCoordinatorDirectoryPath(), "sandbox-base-images");
  const lockDirectoryPath = join(lockRootDirectoryPath, `${tag}.lock`);
  const ownerFilePath = join(lockDirectoryPath, "owner.json");
  const deadline = systemClock.nowMs() + SandboxBaseImageLockTimeoutMs;

  await mkdir(lockRootDirectoryPath, {
    recursive: true,
  });

  while (systemClock.nowMs() < deadline) {
    try {
      await mkdir(lockDirectoryPath);
      await writeFile(
        ownerFilePath,
        JSON.stringify({
          pid: process.pid,
          createdAt: systemClock.nowMs(),
          tag,
        }),
        "utf8",
      );

      try {
        return await callback();
      } finally {
        await rm(lockDirectoryPath, {
          recursive: true,
          force: true,
        });
      }
    } catch (error) {
      if (!isNodeErrorCode(error, "EEXIST")) {
        throw error;
      }

      await removeStaleSystemTestSandboxBaseImageLock({
        lockDirectoryPath,
        ownerFilePath,
      });
      await systemSleeper.sleep(SandboxBaseImageLockPollIntervalMs);
    }
  }

  throw new Error(
    `Timed out acquiring system test sandbox base image lock '${lockDirectoryPath}'.`,
  );
}

function readTestCoordinatorDirectoryPath(): string {
  const coordinatorDir = process.env[MISTLE_TEST_COORDINATOR_DIR_ENV];
  if (coordinatorDir !== undefined && coordinatorDir.length > 0) {
    return coordinatorDir;
  }

  return join(tmpdir(), "mistle-test-harness", "system-runtime");
}

async function removeStaleSystemTestSandboxBaseImageLock(input: {
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
    throw new Error(`Invalid system test sandbox base image lock owner '${ownerFilePath}'.`, {
      cause: error,
    });
  }

  if (typeof owner !== "object" || owner === null) {
    throw new Error(`Invalid system test sandbox base image lock owner '${ownerFilePath}'.`);
  }

  const pid = Reflect.get(owner, "pid");
  if (typeof pid !== "number" || !Number.isInteger(pid)) {
    throw new Error(`Invalid system test sandbox base image lock owner '${ownerFilePath}'.`);
  }

  return pid;
}

async function isLockDirectoryExpired(lockDirectoryPath: string): Promise<boolean> {
  try {
    const stats = await stat(lockDirectoryPath);
    return stats.mtimeMs + SandboxBaseImageLockTimeoutMs < systemClock.nowMs();
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

async function syncControlPlaneIntegrationTargets(input: {
  environment: IntegrationTestEnvironment;
  configPathInContainer: string;
}): Promise<void> {
  await runCommand({
    command: "pnpm",
    args: ["--filter", "@mistle/control-plane-api", "integration-targets:sync"],
    cwd: DefaultBuildContextHostPath,
    env: {
      MISTLE_CONFIG_PATH: resolveHostPathFromContainerPath({
        buildContextHostPath: DefaultBuildContextHostPath,
        containerPath: input.configPathInContainer,
      }),
      MISTLE_POSTGRES_CONTROL_PLANE_POOLED_URL: input.environment.controlPlaneDatabase.pooledUrl,
      MISTLE_CONTROL_PLANE_SCHEMA_NAME: input.environment.controlPlaneDatabase.schemaName,
    },
  });
}

export function resolveRuntimeSystemIntegrationConfigPathInContainer(
  input: CreateSystemTestInput,
): string {
  if (input.sandbox?.provider === "e2b") {
    return E2BIntegrationConfigPathInContainer;
  }

  return DockerIntegrationConfigPathInContainer;
}

async function runCommand(input: {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
}): Promise<void> {
  try {
    await execFileAsync(input.command, input.args, {
      cwd: input.cwd,
      env: {
        ...process.env,
        ...input.env,
      },
    });
  } catch (error) {
    const stderr = readErrorOutput(error, "stderr");
    const stdout = readErrorOutput(error, "stdout");
    const output = stderr.length > 0 ? stderr : stdout.length > 0 ? stdout : "no command output";
    throw new Error(`Command failed: ${input.command} ${input.args.join(" ")}. Output: ${output}`);
  }
}

function readErrorOutput(error: unknown, property: "stderr" | "stdout"): string {
  if (typeof error !== "object" || error === null) {
    return "";
  }

  const descriptor = Object.getOwnPropertyDescriptor(error, property);
  const output = descriptor?.value;
  if (typeof output === "string") {
    return output;
  }

  if (Buffer.isBuffer(output)) {
    return output.toString("utf8");
  }

  return "";
}

function createRuntimeSystemEnvironment(
  env: IntegrationTestEnvironment,
): RuntimeSystemTestEnvironment {
  return {
    id: env.id,
    env,
    get controlPlaneApi() {
      return env.controlPlaneApi;
    },
    get controlPlaneWorker() {
      return env.controlPlaneWorker;
    },
    get dataPlaneApi() {
      return env.dataPlaneApi;
    },
    get dataPlaneGateway() {
      return env.dataPlaneGateway;
    },
    get dataPlaneWorker() {
      return env.dataPlaneWorker;
    },
  };
}
