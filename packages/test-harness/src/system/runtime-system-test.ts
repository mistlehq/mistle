/* eslint-disable jest/expect-expect, jest/no-disabled-tests, no-empty-pattern --
 * This module defines Vitest fixtures instead of declaring test cases. Vitest
 * fixture functions must use object destructuring for the first argument.
 */

import { execFile } from "node:child_process";
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

import { runCleanupTasks, type CleanupTask } from "../cleanup/index.js";
import { createDockerSandboxProviderInfra } from "../environment/service-catalog.js";
import type { TestEnvironment, TestInfraRequirement } from "../environment/types.js";
import { createIntegrationTest, type IntegrationTestEnvironment } from "../integration/index.js";
import { ServiceIds, type ServiceId } from "../integration/services/service-ids.js";
import { IntegrationConfigPathInContainer } from "./integration-config-paths.js";
import { resolveHostPathFromContainerPath } from "./provision-system-integration-targets.js";
import type { RuntimePublicAccessTunnel } from "./runtime-public-access.js";
import { startRuntimeCloudflaredTunnel } from "./runtime-public-access.js";
import {
  getSystemTestSandboxBaseImageRef,
  readSystemTestCoordinatorDirectoryPath,
} from "./system-test-sandbox-base-image.js";

const execFileAsync = promisify(execFile);
const DefaultBuildContextHostPath = fileURLToPath(new URL("../../../..", import.meta.url));

export type SystemTestServiceSelection =
  | ServiceId
  | {
      service: ServiceId;
      mode: "runtime" | "process";
    };

export type SystemTestExtraInfraId = "mailpit" | "otlp" | "seaweedfs";

export type SystemTestSandboxProvider = "docker" | "e2b" | "tensorlake";

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
  dataPlaneGateway?: {
    directEgress?: {
      trustedCaCertificates?: readonly string[];
    };
  };
  publicAccess?: SystemTestPublicAccess;
  auth?: {
    google?: "simulated";
  };
};

export type RuntimeSystemTestEnvironment = {
  id: string;
  env: IntegrationTestEnvironment;
  sandbox?: SystemTestSandbox;
  controlPlaneApi: IntegrationTestEnvironment["controlPlaneApi"];
  controlPlaneWorker: IntegrationTestEnvironment["controlPlaneWorker"];
  dataPlaneApi: IntegrationTestEnvironment["dataPlaneApi"];
  dataPlaneGateway: IntegrationTestEnvironment["dataPlaneGateway"];
  dataPlaneWorker: IntegrationTestEnvironment["dataPlaneWorker"];
  publicAccess?: RuntimeSystemPublicAccess;
};

export type RuntimeSystemPublicAccess = Pick<
  RuntimePublicAccessTunnel,
  "checkReady" | "publicBaseUrls" | "readDiagnostics"
>;

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
const DockerSocketPath = "/var/run/docker.sock";
const PublicAccessHostnameEnvVars = new Map<ServiceId, string>([
  [ServiceIds.CONTROL_PLANE_API, "CONTROL_PLANE_API_TUNNEL_HOSTNAME"],
  [ServiceIds.DATA_PLANE_GATEWAY, "DATA_PLANE_API_TUNNEL_HOSTNAME"],
]);

export function createSystemTest(input: CreateSystemTestInput = {}) {
  let publicAccessTunnel: RuntimePublicAccessTunnel | undefined;
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
      publicAccessTunnel = await startPublicAccess({
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
        await use(createRuntimeSystemEnvironment(env, input.sandbox, publicAccessTunnel));
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
    case "tensorlake":
      return [];
  }
}

export async function createRuntimeSystemServiceOptions(input: CreateSystemTestInput): Promise<{
  dataPlaneGateway?: {
    directEgress?: {
      trustedCaCertificates?: readonly string[];
    };
  };
  sandbox?: {
    provider: SystemTestSandboxProvider;
    defaultBaseImageRef?: string;
    e2b?: {
      apiKey: string;
      domain?: string;
      cpuCount?: string;
      memoryMb?: string;
    };
    tensorlake?: {
      apiKey: string;
    };
    publicServiceBaseUrls?: ReadonlyMap<ServiceId, string>;
  };
}> {
  if (input.sandbox === undefined) {
    if (input.dataPlaneGateway === undefined) {
      return {};
    }

    return {
      dataPlaneGateway: input.dataPlaneGateway,
    };
  }

  if (input.sandbox.provider === "docker") {
    if (input.dataPlaneGateway === undefined) {
      return {
        sandbox: {
          provider: "docker",
        },
      };
    }

    return {
      dataPlaneGateway: input.dataPlaneGateway,
      sandbox: {
        provider: "docker",
      },
    };
  }

  const publicServiceBaseUrls = createPublicServiceBaseUrls(input.publicAccess);
  if (input.sandbox.provider === "e2b") {
    if (input.dataPlaneGateway === undefined) {
      return {
        sandbox: {
          provider: "e2b",
          defaultBaseImageRef: await getSystemTestSandboxBaseImageRef(),
          e2b: readE2BOptions(),
          publicServiceBaseUrls,
        },
      };
    }

    return {
      dataPlaneGateway: input.dataPlaneGateway,
      sandbox: {
        provider: "e2b",
        defaultBaseImageRef: await getSystemTestSandboxBaseImageRef(),
        e2b: readE2BOptions(),
        publicServiceBaseUrls,
      },
    };
  }

  if (input.dataPlaneGateway === undefined) {
    return {
      sandbox: {
        provider: "tensorlake",
        defaultBaseImageRef: await getSystemTestSandboxBaseImageRef(),
        tensorlake: readTensorlakeOptions(),
        publicServiceBaseUrls,
      },
    };
  }

  return {
    dataPlaneGateway: input.dataPlaneGateway,
    sandbox: {
      provider: "tensorlake",
      defaultBaseImageRef: await getSystemTestSandboxBaseImageRef(),
      tensorlake: readTensorlakeOptions(),
      publicServiceBaseUrls,
    },
  };
}

function readTensorlakeOptions(): {
  apiKey: string;
} {
  return {
    apiKey: readRequiredEnv("TENSORLAKE_API_KEY"),
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
    templateLockDirectoryPath: join(
      readSystemTestCoordinatorDirectoryPath(),
      "e2b-template-aliases",
    ),
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
  void input;
  return IntegrationConfigPathInContainer;
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
    const exitCode = readErrorExitCode(error);
    const output = formatCommandFailureOutput({ stdout, stderr });
    throw new Error(
      `Command failed: ${input.command} ${input.args.join(" ")}.${exitCode} Output:${output}`,
    );
  }
}

function formatCommandFailureOutput(input: { stdout: string; stderr: string }): string {
  const parts: string[] = [];

  if (input.stdout.length > 0) {
    parts.push(`\nstdout:\n${input.stdout}`);
  }

  if (input.stderr.length > 0) {
    parts.push(`\nstderr:\n${input.stderr}`);
  }

  if (parts.length === 0) {
    return "\nno command output";
  }

  return parts.join("");
}

function readErrorExitCode(error: unknown): string {
  if (typeof error !== "object" || error === null) {
    return "";
  }

  const descriptor = Object.getOwnPropertyDescriptor(error, "code");
  const code = descriptor?.value;
  if (typeof code === "number" || typeof code === "string") {
    return ` Exit code: ${code}.`;
  }

  return "";
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
  sandbox: SystemTestSandbox | undefined,
  publicAccess: RuntimeSystemPublicAccess | undefined,
): RuntimeSystemTestEnvironment {
  return {
    id: env.id,
    env,
    ...(sandbox === undefined ? {} : { sandbox }),
    ...(publicAccess === undefined ? {} : { publicAccess }),
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
