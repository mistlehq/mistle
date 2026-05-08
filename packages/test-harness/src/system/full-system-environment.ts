import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { systemClock, systemSleeper } from "@mistle/time";
import { type StartedNetwork } from "testcontainers";
import { GenericContainer } from "testcontainers";

import { startControlPlaneApi, type ControlPlaneApiService } from "../apps/control-plane-api.js";
import {
  startControlPlaneWorker,
  type ControlPlaneWorkerService,
} from "../apps/control-plane-worker.js";
import { startDataPlaneApi, type DataPlaneApiService } from "../apps/data-plane-api.js";
import { startDataPlaneGateway, type DataPlaneGatewayService } from "../apps/data-plane-gateway.js";
import { startDataPlaneWorker, type DataPlaneWorkerService } from "../apps/data-plane-worker.js";
import { startTokenizerProxy, type TokenizerProxyService } from "../apps/tokenizer-proxy.js";
import { runCleanupTasks } from "../cleanup/index.js";
import { stopContainerIgnoringMissing } from "../docker/cleanup.js";
import { startDockerNetwork } from "../network/start-docker-network.js";
import { type StartPostgresWithPgBouncerInput } from "../services/postgres/index.js";
import { acquireSharedPostgresMailpitInfra } from "../services/shared-postgres-mailpit.js";
import { startValkey, type ValkeyService } from "../services/valkey/index.js";
import {
  buildCloudflaredTunnelConfig,
  parseCloudflaredTunnelCredentialsJson,
} from "./cloudflared-config.js";
import { readPreparedTestHarnessRuntime } from "./prepared-runtime.js";
import {
  createControlPlaneDatabaseMigrationCommandInput,
  createControlPlaneIntegrationTargetsSyncCommandInput,
  createControlPlaneWorkflowMigrationCommandInput,
  createDataPlaneDatabaseMigrationCommandInput,
  createDataPlaneWorkflowMigrationCommandInput,
  resolveHostPathFromContainerPath,
} from "./provision-system-integration-targets.js";

const OMITTED_POSTGRES_OPTIONS = [
  "network",
  "postgresNetworkAlias",
  "pgbouncerNetworkAlias",
  "manageProcessCleanup",
  "containerLabels",
] as const;

const CONTROL_PLANE_API_CONTAINER_BASE_URL = "http://control-plane-api:5100";
const DATA_PLANE_API_CONTAINER_BASE_URL = "http://data-plane-api:5200";
const DATA_PLANE_GATEWAY_CONTAINER_BASE_URL = "http://data-plane-gateway:5202";
const TOKENIZER_PROXY_CONTAINER_BASE_URL = "http://tokenizer-proxy:5205";
const DATA_PLANE_GATEWAY_TUNNEL_WS_URL = "ws://data-plane-gateway:5202/tunnel/sandbox";
const DataPlaneGatewayIdleTimeoutMs = 300_000;
const DataPlaneGatewayBootstrapDisconnectGraceMs = 60_000;
const DockerSocketPath = "/var/run/docker.sock";
const REGISTRY_IMAGE_REFERENCE = "registry:3";
const REGISTRY_INTERNAL_PORT = 5000;
const REGISTRY_NETWORK_ALIAS = "registry";
const TRACE_FULL_SYSTEM = process.env.MISTLE_TEST_HARNESS_TRACE === "1";
const CLOUDFLARED_IMAGE_REFERENCE = "cloudflare/cloudflared:latest";
const CloudflaredTunnelStartupTimeoutMs = 180_000;
const CloudflaredTunnelPollIntervalMs = 1_000;
const SystemSandboxProvider = {
  DOCKER: "docker",
  E2B: "e2b",
} as const;
type SystemSandboxProvider = (typeof SystemSandboxProvider)[keyof typeof SystemSandboxProvider];

const execFileAsync = promisify(execFile);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type CloudflaredPublicTunnel = {
  tunnelId: string;
  tunnelCredentialsJson: string;
  publicHostname: string;
};

type CloudflaredTunnelRoute = CloudflaredPublicTunnel & {
  targetHost: string;
  targetPort: number;
};

type SharedPostgresOptions = Omit<
  StartPostgresWithPgBouncerInput,
  (typeof OMITTED_POSTGRES_OPTIONS)[number]
>;

export type StartFullSystemEnvironmentInput = {
  buildContextHostPath: string;
  configPathInContainer: string;
  sandboxProvider: SystemSandboxProvider;
  startupTimeoutMs: number;
  sharedInfraKey: string;
  postgres: SharedPostgresOptions;
  controlPlaneWorkflowNamespaceId: string;
  dataPlaneWorkflowNamespaceId: string;
  authBaseUrl: string;
  dashboardBaseUrl: string;
  authTrustedOrigins: string;
  cacheBustKey?: string;
  controlPlaneApiEnvironment?: Record<string, string>;
  controlPlaneWorkerEnvironment?: Record<string, string>;
  dataPlaneApiEnvironment?: Record<string, string>;
  dataPlaneWorkerEnvironment?: Record<string, string>;
  dataPlaneGatewayEnvironment?: Record<string, string>;
  tokenizerProxyEnvironment?: Record<string, string>;
  sharedControlPlaneTunnel?: CloudflaredPublicTunnel | undefined;
  sandboxPublicGatewayTunnel?: CloudflaredPublicTunnel | undefined;
  sandboxPublicTokenizerProxyTunnel?: CloudflaredPublicTunnel | undefined;
};

export type StartedFullSystemEnvironment = {
  controlPlaneApi: ControlPlaneApiService;
  controlPlaneWorker: ControlPlaneWorkerService;
  dataPlaneApi: DataPlaneApiService;
  dataPlaneWorker: DataPlaneWorkerService;
  dataPlaneGateway: DataPlaneGatewayService;
  tokenizerProxy: TokenizerProxyService;
  database: {
    hostDatabaseUrl: string;
    containerDatabaseUrl: string;
    host: string;
    port: number;
    databaseName: string;
    username: string;
    password: string;
  };
  mailpit: {
    httpBaseUrl: string;
    smtpPort: number;
  };
  valkey: {
    url: string;
  };
  containerHostGateway: string;
  sandboxNetworkName: string;
  dataPlaneGatewayLifecycle: {
    idleTimeoutMs: number;
    bootstrapDisconnectGraceMs: number;
  };
  stop: () => Promise<void>;
};

function createDatabaseUrl(input: {
  username: string;
  password: string;
  host: string;
  port: number;
  databaseName: string;
}): string {
  return `postgresql://${encodeURIComponent(input.username)}:${encodeURIComponent(input.password)}@${input.host}:${String(input.port)}/${input.databaseName}`;
}

function readErrorString(error: unknown, key: "stdout" | "stderr"): string {
  if (!isRecord(error)) {
    return "";
  }

  const value = error[key];
  if (typeof value === "string") {
    return value.trim();
  }

  if (Buffer.isBuffer(value)) {
    return value.toString("utf8").trim();
  }

  return "";
}

function traceFullSystem(message: string): void {
  if (!TRACE_FULL_SYSTEM) {
    return;
  }

  console.info(`[test-harness:full-system] ${message}`);
}

async function waitForCloudflaredHealth(input: {
  publicBaseUrl: string;
  timeoutMs: number;
}): Promise<void> {
  const deadline = systemClock.nowMs() + input.timeoutMs;

  while (systemClock.nowMs() < deadline) {
    try {
      const response = await fetch(`${input.publicBaseUrl}/__healthz`);
      if (response.status === 200) {
        return;
      }
    } catch {
      // Retry until timeout.
    }

    await systemSleeper.sleep(CloudflaredTunnelPollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for cloudflared healthcheck at ${input.publicBaseUrl}/__healthz after ${String(input.timeoutMs)}ms.`,
  );
}

async function readCloudflaredLogs(containerName: string): Promise<string> {
  try {
    const result = await execFileAsync("docker", ["logs", containerName], {
      timeout: 30_000,
      maxBuffer: 1_000_000,
    });

    return result.stderr.trim().length > 0 ? result.stderr : result.stdout;
  } catch (error) {
    return readErrorString(error, "stderr") || readErrorString(error, "stdout");
  }
}

async function startCloudflaredServiceTunnel(input: {
  networkName: string;
  tunnelId: string;
  tunnelCredentialsJson: string;
  ingressRules: ReadonlyArray<{
    publicHostname: string;
    targetHost: string;
    targetPort: number;
  }>;
}): Promise<{
  publicBaseUrls: ReadonlyMap<string, string>;
  stop: () => Promise<void>;
}> {
  const configDirectory = await mkdtemp(join(tmpdir(), "mistle-cloudflared-"));
  const configPath = join(configDirectory, "config.yml");
  const credentialsPath = join(configDirectory, "credentials.json");
  const containerName = `mistle-cloudflared-${randomUUID().replaceAll("-", "")}`;
  if (input.ingressRules.length === 0) {
    throw new Error("Cloudflared service tunnel requires at least one ingress rule.");
  }
  const publicBaseUrls = new Map(
    input.ingressRules.map((rule) => [rule.publicHostname, `https://${rule.publicHostname}`]),
  );
  parseCloudflaredTunnelCredentialsJson({
    tunnelId: input.tunnelId,
    credentialsJson: input.tunnelCredentialsJson,
  });
  const configContent = buildCloudflaredTunnelConfig({
    tunnelId: input.tunnelId,
    credentialsFilePath: "/etc/cloudflared/credentials.json",
    ingressRules: input.ingressRules.map((rule) => ({
      publicHostname: rule.publicHostname,
      serviceUrl: `http://${rule.targetHost}:${String(rule.targetPort)}`,
    })),
  });

  await writeFile(credentialsPath, input.tunnelCredentialsJson, "utf8");
  await writeFile(configPath, configContent, "utf8");

  let started = false;
  try {
    await execFileAsync(
      "docker",
      [
        "run",
        "--detach",
        "--rm",
        "--name",
        containerName,
        "--network",
        input.networkName,
        "--volume",
        `${configPath}:/etc/cloudflared/config.yml:ro`,
        "--volume",
        `${credentialsPath}:/etc/cloudflared/credentials.json:ro`,
        CLOUDFLARED_IMAGE_REFERENCE,
        "tunnel",
        "--config",
        "/etc/cloudflared/config.yml",
        "run",
        input.tunnelId,
      ],
      {
        timeout: 30_000,
        maxBuffer: 1_000_000,
      },
    );
    started = true;

    for (const publicBaseUrl of publicBaseUrls.values()) {
      await waitForCloudflaredHealth({
        publicBaseUrl,
        timeoutMs: CloudflaredTunnelStartupTimeoutMs,
      });
    }

    return {
      publicBaseUrls,
      stop: async () => {
        if (started) {
          await execFileAsync("docker", ["stop", containerName], {
            timeout: 30_000,
            maxBuffer: 1_000_000,
          }).catch(() => undefined);
        }

        await rm(configDirectory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    const writtenConfig = await readFile(configPath, "utf8").catch(() => "");
    const writtenCredentials = await readFile(credentialsPath, "utf8").catch(() => "");
    const logs = started ? await readCloudflaredLogs(containerName) : "";

    if (started) {
      await execFileAsync("docker", ["stop", containerName], {
        timeout: 30_000,
        maxBuffer: 1_000_000,
      }).catch(() => undefined);
    }
    await rm(configDirectory, { recursive: true, force: true });

    throw new Error(
      `Failed to start cloudflared service tunnel for ${input.ingressRules.map((rule) => rule.publicHostname).join(", ")}. ${
        error instanceof Error ? error.message : String(error)
      } Config: ${writtenConfig} Credentials: ${writtenCredentials} Logs: ${logs}`,
    );
  }
}

async function withStepTiming<T>(label: string, operation: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  traceFullSystem(`${label} start`);

  try {
    const result = await operation();
    traceFullSystem(`${label} complete durationMs=${String(Date.now() - startedAt)}`);
    return result;
  } catch (error) {
    traceFullSystem(`${label} failed durationMs=${String(Date.now() - startedAt)}`);
    throw error;
  }
}

async function runCommand(input: {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
}): Promise<void> {
  try {
    await execFileAsync(input.command, input.args, {
      cwd: input.cwd,
      env: input.env === undefined ? process.env : { ...process.env, ...input.env },
    });
  } catch (error) {
    const stderr = readErrorString(error, "stderr");
    const stdout = readErrorString(error, "stdout");
    const output = stderr.length > 0 ? stderr : stdout.length > 0 ? stdout : "no command output";
    throw new Error(`Command failed: ${input.command} ${input.args.join(" ")}. Output: ${output}`);
  }
}

async function listDockerContainerIds(input: {
  cwd: string;
  filters: string[];
}): Promise<string[]> {
  const { stdout } = await execFileAsync("docker", ["ps", "-aq", ...input.filters], {
    cwd: input.cwd,
  });

  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

async function removeDockerContainers(input: {
  cwd: string;
  containerIds: string[];
}): Promise<void> {
  if (input.containerIds.length === 0) {
    return;
  }

  await runCommand({
    command: "docker",
    args: ["rm", "--force", ...input.containerIds],
    cwd: input.cwd,
  });
}

async function removeDockerSandboxContainersOnNetwork(input: {
  cwd: string;
  networkName: string;
}): Promise<void> {
  const containerIds = await listDockerContainerIds({
    cwd: input.cwd,
    filters: [
      "--filter",
      "label=mistle.sandbox.provider=docker",
      "--filter",
      `network=${input.networkName}`,
    ],
  });

  await removeDockerContainers({
    cwd: input.cwd,
    containerIds,
  });
}

async function publishSandboxBaseImage(input: {
  buildContextHostPath: string;
  registryAuthority: string;
  localReference: string;
  repositoryPath: string;
}): Promise<string> {
  const registryImageReference = `${input.registryAuthority}/${input.repositoryPath}:dev`;

  await withStepTiming("tag sandbox base image", async () => {
    await runCommand({
      command: "docker",
      args: ["tag", input.localReference, registryImageReference],
      cwd: input.buildContextHostPath,
    });
  });
  await withStepTiming("push sandbox base image", async () => {
    await runCommand({
      command: "docker",
      args: ["push", registryImageReference],
      cwd: input.buildContextHostPath,
    });
  });

  return registryImageReference;
}

export async function startFullSystemEnvironment(
  input: StartFullSystemEnvironmentInput,
): Promise<StartedFullSystemEnvironment> {
  const cleanupTasks: Array<() => Promise<void>> = [];
  let stopped = false;
  let network: StartedNetwork | undefined;
  let valkeyService: ValkeyService | undefined;
  const preparedRuntime = await readPreparedTestHarnessRuntime(input.buildContextHostPath);

  try {
    const sharedInfraLease = await withStepTiming(
      "acquire shared postgres/mailpit infra",
      async () => {
        return acquireSharedPostgresMailpitInfra({
          key: input.sharedInfraKey,
          postgres: input.postgres,
        });
      },
    );
    cleanupTasks.unshift(async () => {
      await sharedInfraLease.release();
    });

    network = await withStepTiming("start docker network", async () => startDockerNetwork());
    const activeNetwork = network;
    if (activeNetwork === undefined) {
      throw new Error("Failed to start Docker network for full system environment.");
    }
    cleanupTasks.unshift(async () => {
      if (network !== undefined) {
        await network.stop();
      }
    });
    cleanupTasks.unshift(async () => {
      if (network !== undefined) {
        await removeDockerSandboxContainersOnNetwork({
          cwd: input.buildContextHostPath,
          networkName: network.getName(),
        });
      }
    });

    valkeyService = await withStepTiming("start valkey", async () => {
      return startValkey({
        manageProcessCleanup: false,
        network: activeNetwork,
      });
    });
    cleanupTasks.unshift(async () => {
      await valkeyService?.stop();
    });

    const registryContainer = await withStepTiming("start registry container", async () => {
      return new GenericContainer(REGISTRY_IMAGE_REFERENCE)
        .withEnvironment({
          REGISTRY_STORAGE_DELETE_ENABLED: "true",
        })
        .withExposedPorts(REGISTRY_INTERNAL_PORT)
        .withNetwork(activeNetwork)
        .withNetworkAliases(REGISTRY_NETWORK_ALIAS)
        .start();
    });
    cleanupTasks.unshift(async () => {
      await stopContainerIgnoringMissing(registryContainer, {
        remove: true,
        removeVolumes: true,
        timeout: 0,
      });
    });
    const registryAuthority = `${registryContainer.getHost()}:${String(registryContainer.getMappedPort(REGISTRY_INTERNAL_PORT))}`;
    const sandboxBaseImageReference = await withStepTiming(
      "publish sandbox base image",
      async () => {
        return publishSandboxBaseImage({
          buildContextHostPath: input.buildContextHostPath,
          registryAuthority,
          localReference: preparedRuntime.sandboxBaseImage.localReference,
          repositoryPath: preparedRuntime.sandboxBaseImage.repositoryPath,
        });
      },
    );
    const isDockerSandboxProvider = input.sandboxProvider === SystemSandboxProvider.DOCKER;

    const hostDatabaseUrl = sharedInfraLease.infra.postgres.directUrl;
    const containerDatabaseUrl = createDatabaseUrl({
      username: sharedInfraLease.infra.postgres.postgres.username,
      password: sharedInfraLease.infra.postgres.postgres.password,
      host: sharedInfraLease.infra.containerHostGateway,
      port: sharedInfraLease.infra.postgres.postgres.port,
      databaseName: sharedInfraLease.infra.postgres.postgres.databaseName,
    });

    await withStepTiming("run data-plane database migrations", async () => {
      await runCommand(
        createDataPlaneDatabaseMigrationCommandInput({
          buildContextHostPath: input.buildContextHostPath,
          configPathInContainer: input.configPathInContainer,
          hostDatabaseUrl,
        }),
      );
    });
    await withStepTiming("run data-plane workflow migrations", async () => {
      await runCommand(
        createDataPlaneWorkflowMigrationCommandInput({
          buildContextHostPath: input.buildContextHostPath,
          configPathInContainer: input.configPathInContainer,
          hostDatabaseUrl,
        }),
      );
    });
    await withStepTiming("run control-plane database migrations", async () => {
      await runCommand(
        createControlPlaneDatabaseMigrationCommandInput({
          buildContextHostPath: input.buildContextHostPath,
          configPathInContainer: input.configPathInContainer,
          hostDatabaseUrl,
        }),
      );
    });
    await withStepTiming("run control-plane workflow migrations", async () => {
      await runCommand(
        createControlPlaneWorkflowMigrationCommandInput({
          buildContextHostPath: input.buildContextHostPath,
          configPathInContainer: input.configPathInContainer,
          hostDatabaseUrl,
        }),
      );
    });

    const dataPlaneApi = await withStepTiming("start data-plane-api", async () => {
      return startDataPlaneApi({
        buildContextHostPath: input.buildContextHostPath,
        configPathInContainer: input.configPathInContainer,
        startupTimeoutMs: input.startupTimeoutMs,
        ...(input.cacheBustKey === undefined
          ? {}
          : {
              cacheBustKey: input.cacheBustKey,
            }),
        prebuiltImageName: preparedRuntime.appImages.dataPlaneApi,
        network: activeNetwork,
        ...(isDockerSandboxProvider
          ? {
              bindMounts: [
                {
                  source: DockerSocketPath,
                  target: DockerSocketPath,
                  mode: "rw",
                },
              ],
            }
          : {}),
        environment: {
          ...input.dataPlaneApiEnvironment,
          MISTLE_POSTGRES_DATA_PLANE_POOLED_URL: containerDatabaseUrl,
          MISTLE_POSTGRES_DATA_PLANE_DIRECT_URL: containerDatabaseUrl,
          MISTLE_WORKFLOW_DATA_PLANE_NAMESPACE_ID: input.dataPlaneWorkflowNamespaceId,
          MISTLE_SERVICES_DATA_PLANE_GATEWAY_INTERNAL_URL: DATA_PLANE_GATEWAY_CONTAINER_BASE_URL,
          ...(isDockerSandboxProvider
            ? {
                MISTLE_SANDBOX_DOCKER_SOCKET_PATH: DockerSocketPath,
              }
            : {}),
        },
      });
    });
    cleanupTasks.unshift(async () => {
      await dataPlaneApi.stop();
    });

    const dataPlaneGateway = await withStepTiming("start data-plane-gateway", async () => {
      return startDataPlaneGateway({
        buildContextHostPath: input.buildContextHostPath,
        configPathInContainer: input.configPathInContainer,
        startupTimeoutMs: input.startupTimeoutMs,
        ...(input.cacheBustKey === undefined
          ? {}
          : {
              cacheBustKey: input.cacheBustKey,
            }),
        prebuiltImageName: preparedRuntime.appImages.dataPlaneGateway,
        network: activeNetwork,
        environment: {
          ...input.dataPlaneGatewayEnvironment,
          MISTLE_POSTGRES_DATA_PLANE_POOLED_URL: containerDatabaseUrl,
          MISTLE_KV_DATA_PLANE_BACKEND: "valkey",
          MISTLE_KV_DATA_PLANE_URL: "redis://valkey:6379",
          MISTLE_SERVICES_DATA_PLANE_API_INTERNAL_URL: DATA_PLANE_API_CONTAINER_BASE_URL,
        },
      });
    });
    cleanupTasks.unshift(async () => {
      await dataPlaneGateway.stop();
    });
    const gatewayWsUrl =
      input.sandboxPublicGatewayTunnel === undefined
        ? DATA_PLANE_GATEWAY_TUNNEL_WS_URL
        : `wss://${input.sandboxPublicGatewayTunnel.publicHostname}/tunnel/sandbox`;
    const controlPlaneApi = await withStepTiming("start control-plane-api", async () => {
      return startControlPlaneApi({
        buildContextHostPath: input.buildContextHostPath,
        configPathInContainer: input.configPathInContainer,
        startupTimeoutMs: input.startupTimeoutMs,
        ...(input.cacheBustKey === undefined
          ? {}
          : {
              cacheBustKey: input.cacheBustKey,
            }),
        prebuiltImageName: preparedRuntime.appImages.controlPlaneApi,
        network: activeNetwork,
        environment: {
          ...input.controlPlaneApiEnvironment,
          MISTLE_POSTGRES_CONTROL_PLANE_POOLED_URL: containerDatabaseUrl,
          MISTLE_POSTGRES_CONTROL_PLANE_DIRECT_URL: containerDatabaseUrl,
          MISTLE_WORKFLOW_CONTROL_PLANE_NAMESPACE_ID: input.controlPlaneWorkflowNamespaceId,
          MISTLE_SERVICES_CONTROL_PLANE_API_PUBLIC_URL: input.authBaseUrl,
          MISTLE_SERVICES_DASHBOARD_PUBLIC_URL: input.dashboardBaseUrl,
          MISTLE_SERVICES_CONTROL_PLANE_API_AUTH_TRUSTED_ORIGINS: input.authTrustedOrigins,
          MISTLE_SERVICES_DATA_PLANE_API_INTERNAL_URL: DATA_PLANE_API_CONTAINER_BASE_URL,
          ...(isDockerSandboxProvider
            ? {
                MISTLE_SANDBOX_DEFAULT_BASE_IMAGE: sandboxBaseImageReference,
              }
            : {}),
          MISTLE_SERVICES_DATA_PLANE_GATEWAY_SANDBOX_WS_PUBLIC_URL: gatewayWsUrl,
        },
      });
    });
    cleanupTasks.unshift(async () => {
      await controlPlaneApi.stop();
    });
    await withStepTiming("sync control-plane integration targets", async () => {
      await runCommand(
        createControlPlaneIntegrationTargetsSyncCommandInput({
          buildContextHostPath: input.buildContextHostPath,
          configPathInContainer: input.configPathInContainer,
          hostDatabaseUrl,
        }),
      );
    });

    const controlPlaneWorker = await withStepTiming("start control-plane-worker", async () => {
      return startControlPlaneWorker({
        buildContextHostPath: input.buildContextHostPath,
        configPathInContainer: input.configPathInContainer,
        startupTimeoutMs: input.startupTimeoutMs,
        ...(input.cacheBustKey === undefined
          ? {}
          : {
              cacheBustKey: input.cacheBustKey,
            }),
        prebuiltImageName: preparedRuntime.appImages.controlPlaneWorker,
        network: activeNetwork,
        environment: {
          ...input.controlPlaneWorkerEnvironment,
          MISTLE_POSTGRES_CONTROL_PLANE_POOLED_URL: containerDatabaseUrl,
          MISTLE_WORKFLOW_CONTROL_PLANE_NAMESPACE_ID: input.controlPlaneWorkflowNamespaceId,
          MISTLE_EMAIL_SMTP_HOST: sharedInfraLease.infra.containerHostGateway,
          MISTLE_EMAIL_SMTP_PORT: String(sharedInfraLease.infra.mailpit.smtpPort),
          MISTLE_EMAIL_SMTP_SECURE: "false",
          MISTLE_SERVICES_DATA_PLANE_API_INTERNAL_URL: DATA_PLANE_API_CONTAINER_BASE_URL,
          MISTLE_SERVICES_CONTROL_PLANE_API_INTERNAL_URL: CONTROL_PLANE_API_CONTAINER_BASE_URL,
        },
      });
    });
    cleanupTasks.unshift(async () => {
      await controlPlaneWorker.stop();
    });

    const tokenizerProxy = await withStepTiming("start tokenizer-proxy", async () => {
      return startTokenizerProxy({
        buildContextHostPath: input.buildContextHostPath,
        configPathInContainer: input.configPathInContainer,
        startupTimeoutMs: input.startupTimeoutMs,
        ...(input.cacheBustKey === undefined
          ? {}
          : {
              cacheBustKey: input.cacheBustKey,
            }),
        prebuiltImageName: preparedRuntime.appImages.tokenizerProxy,
        network: activeNetwork,
        environment: {
          ...input.tokenizerProxyEnvironment,
          MISTLE_SERVICES_CONTROL_PLANE_API_INTERNAL_URL: CONTROL_PLANE_API_CONTAINER_BASE_URL,
        },
      });
    });
    cleanupTasks.unshift(async () => {
      await withStepTiming("stop tokenizer-proxy", async () => tokenizerProxy.stop());
    });
    const dataPlaneWorker = await withStepTiming("start data-plane-worker", async () => {
      return startDataPlaneWorker({
        buildContextHostPath: input.buildContextHostPath,
        configPathInContainer: input.configPathInContainer,
        startupTimeoutMs: input.startupTimeoutMs,
        ...(input.cacheBustKey === undefined
          ? {}
          : {
              cacheBustKey: input.cacheBustKey,
            }),
        prebuiltImageName: preparedRuntime.appImages.dataPlaneWorker,
        network,
        environment: {
          ...input.dataPlaneWorkerEnvironment,
          MISTLE_POSTGRES_DATA_PLANE_POOLED_URL: containerDatabaseUrl,
          MISTLE_WORKFLOW_DATA_PLANE_NAMESPACE_ID: input.dataPlaneWorkflowNamespaceId,
          MISTLE_SERVICES_DATA_PLANE_GATEWAY_INTERNAL_URL: DATA_PLANE_GATEWAY_CONTAINER_BASE_URL,
          ...(isDockerSandboxProvider
            ? {
                MISTLE_SANDBOX_DOCKER_SOCKET_PATH: "/var/run/docker.sock",
                MISTLE_SANDBOX_DOCKER_NETWORK_NAME: activeNetwork.getName(),
              }
            : {}),
          MISTLE_SANDBOX_PROVIDER: input.sandboxProvider,
          MISTLE_SERVICES_DATA_PLANE_GATEWAY_SANDBOX_WS_PUBLIC_URL: gatewayWsUrl,
          MISTLE_SERVICES_DATA_PLANE_GATEWAY_SANDBOX_WS_INTERNAL_URL: gatewayWsUrl,
        },
      });
    });
    cleanupTasks.unshift(async () => {
      await dataPlaneWorker.stop();
    });

    const publicTunnelRoutes: CloudflaredTunnelRoute[] = [];
    const addPublicTunnelRoute = (
      tunnel: CloudflaredPublicTunnel | undefined,
      targetHost: string,
      targetPort: number,
    ): void => {
      if (tunnel === undefined) {
        return;
      }

      publicTunnelRoutes.push({
        tunnelId: tunnel.tunnelId,
        tunnelCredentialsJson: tunnel.tunnelCredentialsJson,
        publicHostname: tunnel.publicHostname,
        targetHost,
        targetPort,
      });
    };

    addPublicTunnelRoute(input.sharedControlPlaneTunnel, "control-plane-api", 5100);
    addPublicTunnelRoute(input.sandboxPublicGatewayTunnel, "data-plane-gateway", 5202);
    addPublicTunnelRoute(input.sandboxPublicTokenizerProxyTunnel, "tokenizer-proxy", 5205);

    const publicTunnelGroups = new Map<
      string,
      {
        tunnelId: string;
        tunnelCredentialsJson: string;
        ingressRules: CloudflaredTunnelRoute[];
      }
    >();
    for (const route of publicTunnelRoutes) {
      const groupKey = `${route.tunnelId}:${route.tunnelCredentialsJson}`;
      const existingGroup = publicTunnelGroups.get(groupKey);
      if (existingGroup === undefined) {
        publicTunnelGroups.set(groupKey, {
          tunnelId: route.tunnelId,
          tunnelCredentialsJson: route.tunnelCredentialsJson,
          ingressRules: [route],
        });
        continue;
      }

      existingGroup.ingressRules.push(route);
    }

    for (const group of publicTunnelGroups.values()) {
      const startedPublicTunnel = await withStepTiming(
        `start public tunnel for ${group.ingressRules.map((route) => route.publicHostname).join(", ")}`,
        async () => {
          return startCloudflaredServiceTunnel({
            networkName: activeNetwork.getName(),
            tunnelId: group.tunnelId,
            tunnelCredentialsJson: group.tunnelCredentialsJson,
            ingressRules: group.ingressRules,
          });
        },
      );
      cleanupTasks.unshift(async () => {
        await startedPublicTunnel.stop();
      });
    }

    return {
      controlPlaneApi,
      controlPlaneWorker,
      dataPlaneApi,
      dataPlaneWorker,
      dataPlaneGateway,
      tokenizerProxy,
      database: {
        hostDatabaseUrl,
        containerDatabaseUrl,
        host: sharedInfraLease.infra.postgres.postgres.host,
        port: sharedInfraLease.infra.postgres.postgres.port,
        databaseName: sharedInfraLease.infra.postgres.postgres.databaseName,
        username: sharedInfraLease.infra.postgres.postgres.username,
        password: sharedInfraLease.infra.postgres.postgres.password,
      },
      mailpit: {
        httpBaseUrl: sharedInfraLease.infra.mailpit.httpBaseUrl,
        smtpPort: sharedInfraLease.infra.mailpit.smtpPort,
      },
      valkey: {
        url: valkeyService.url,
      },
      containerHostGateway: sharedInfraLease.infra.containerHostGateway,
      sandboxNetworkName: activeNetwork.getName(),
      dataPlaneGatewayLifecycle: {
        idleTimeoutMs: DataPlaneGatewayIdleTimeoutMs,
        bootstrapDisconnectGraceMs: DataPlaneGatewayBootstrapDisconnectGraceMs,
      },
      stop: async () => {
        if (stopped) {
          throw new Error("Full system environment was already stopped.");
        }

        stopped = true;
        await runCleanupTasks({
          tasks: cleanupTasks,
          context: "full system environment cleanup",
        });
      },
    };
  } catch (error) {
    await runCleanupTasks({
      tasks: cleanupTasks,
      context: "full system environment setup rollback",
    });
    throw error;
  }
}

export {
  createControlPlaneDatabaseMigrationCommandInput,
  createControlPlaneIntegrationTargetsSyncCommandInput,
  createControlPlaneWorkflowMigrationCommandInput,
  createDataPlaneDatabaseMigrationCommandInput,
  createDataPlaneWorkflowMigrationCommandInput,
  resolveHostPathFromContainerPath,
};

export const FullSystemContainerBaseUrls = {
  CONTROL_PLANE_API: CONTROL_PLANE_API_CONTAINER_BASE_URL,
  DATA_PLANE_API: DATA_PLANE_API_CONTAINER_BASE_URL,
  DATA_PLANE_GATEWAY: DATA_PLANE_GATEWAY_CONTAINER_BASE_URL,
  TOKENIZER_PROXY: TOKENIZER_PROXY_CONTAINER_BASE_URL,
} as const;
