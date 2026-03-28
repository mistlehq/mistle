import { execFile } from "node:child_process";
import { promisify } from "node:util";

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
  readPreparedTestHarnessRuntime,
  SANDBOX_SNAPSHOT_REPOSITORY_PATH,
} from "./prepared-runtime.js";
import {
  createControlPlaneIntegrationTargetsSyncCommandInput,
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
const TOKENIZER_PROXY_EGRESS_CONTAINER_BASE_URL = `${TOKENIZER_PROXY_CONTAINER_BASE_URL}/tokenizer-proxy/egress`;
const DATA_PLANE_GATEWAY_TUNNEL_WS_URL = "ws://data-plane-gateway:5202/tunnel/sandbox";
const DockerSocketPath = "/var/run/docker.sock";
const REGISTRY_IMAGE_REFERENCE = "registry:3";
const REGISTRY_INTERNAL_PORT = 5000;
const REGISTRY_NETWORK_ALIAS = "registry";
const TRACE_FULL_SYSTEM = process.env.MISTLE_TEST_HARNESS_TRACE === "1";

const execFileAsync = promisify(execFile);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type SharedPostgresOptions = Omit<
  StartPostgresWithPgBouncerInput,
  (typeof OMITTED_POSTGRES_OPTIONS)[number]
>;

export type StartFullSystemEnvironmentInput = {
  buildContextHostPath: string;
  configPathInContainer: string;
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
    const sandboxSnapshotRepository = `${registryAuthority}/${SANDBOX_SNAPSHOT_REPOSITORY_PATH}`;

    const hostDatabaseUrl = sharedInfraLease.infra.postgres.directUrl;
    const containerDatabaseUrl = createDatabaseUrl({
      username: sharedInfraLease.infra.postgres.postgres.username,
      password: sharedInfraLease.infra.postgres.postgres.password,
      host: sharedInfraLease.infra.containerHostGateway,
      port: sharedInfraLease.infra.postgres.postgres.port,
      databaseName: sharedInfraLease.infra.postgres.postgres.databaseName,
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
        bindMounts: [
          {
            source: DockerSocketPath,
            target: DockerSocketPath,
            mode: "rw",
          },
        ],
        environment: {
          ...input.dataPlaneApiEnvironment,
          MISTLE_APPS_DATA_PLANE_API_DATABASE_URL: containerDatabaseUrl,
          MISTLE_APPS_DATA_PLANE_API_DATABASE_MIGRATION_URL: containerDatabaseUrl,
          MISTLE_APPS_DATA_PLANE_API_WORKFLOW_DATABASE_URL: containerDatabaseUrl,
          MISTLE_APPS_DATA_PLANE_API_WORKFLOW_NAMESPACE_ID: input.dataPlaneWorkflowNamespaceId,
          MISTLE_APPS_DATA_PLANE_API_RUNTIME_STATE_GATEWAY_BASE_URL:
            DATA_PLANE_GATEWAY_CONTAINER_BASE_URL,
          MISTLE_APPS_DATA_PLANE_API_SANDBOX_DOCKER_SOCKET_PATH: DockerSocketPath,
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
          MISTLE_APPS_DATA_PLANE_GATEWAY_DATABASE_URL: containerDatabaseUrl,
          MISTLE_APPS_DATA_PLANE_GATEWAY_RUNTIME_STATE_BACKEND: "valkey",
          MISTLE_APPS_DATA_PLANE_GATEWAY_RUNTIME_STATE_VALKEY_URL: "redis://valkey:6379",
        },
      });
    });
    cleanupTasks.unshift(async () => {
      await dataPlaneGateway.stop();
    });
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
          MISTLE_APPS_CONTROL_PLANE_API_DATABASE_URL: containerDatabaseUrl,
          MISTLE_APPS_CONTROL_PLANE_API_DATABASE_MIGRATION_URL: containerDatabaseUrl,
          MISTLE_APPS_CONTROL_PLANE_API_WORKFLOW_DATABASE_URL: containerDatabaseUrl,
          MISTLE_APPS_CONTROL_PLANE_API_WORKFLOW_NAMESPACE_ID:
            input.controlPlaneWorkflowNamespaceId,
          MISTLE_APPS_CONTROL_PLANE_API_AUTH_BASE_URL: input.authBaseUrl,
          MISTLE_APPS_CONTROL_PLANE_API_DASHBOARD_BASE_URL: input.dashboardBaseUrl,
          MISTLE_APPS_CONTROL_PLANE_API_AUTH_TRUSTED_ORIGINS: input.authTrustedOrigins,
          MISTLE_APPS_CONTROL_PLANE_API_DATA_PLANE_API_BASE_URL: DATA_PLANE_API_CONTAINER_BASE_URL,
          MISTLE_GLOBAL_SANDBOX_DEFAULT_BASE_IMAGE: sandboxBaseImageReference,
          MISTLE_GLOBAL_SANDBOX_GATEWAY_WS_URL: DATA_PLANE_GATEWAY_TUNNEL_WS_URL,
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
          MISTLE_APPS_CONTROL_PLANE_WORKER_WORKFLOW_DATABASE_URL: containerDatabaseUrl,
          MISTLE_APPS_CONTROL_PLANE_WORKER_WORKFLOW_NAMESPACE_ID:
            input.controlPlaneWorkflowNamespaceId,
          MISTLE_APPS_CONTROL_PLANE_WORKER_WORKFLOW_RUN_MIGRATIONS: "false",
          MISTLE_APPS_CONTROL_PLANE_WORKER_SMTP_HOST: sharedInfraLease.infra.containerHostGateway,
          MISTLE_APPS_CONTROL_PLANE_WORKER_SMTP_PORT: String(
            sharedInfraLease.infra.mailpit.smtpPort,
          ),
          MISTLE_APPS_CONTROL_PLANE_WORKER_SMTP_SECURE: "false",
          MISTLE_APPS_CONTROL_PLANE_WORKER_DATA_PLANE_API_BASE_URL:
            DATA_PLANE_API_CONTAINER_BASE_URL,
          MISTLE_APPS_CONTROL_PLANE_WORKER_CONTROL_PLANE_API_BASE_URL:
            CONTROL_PLANE_API_CONTAINER_BASE_URL,
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
          MISTLE_APPS_TOKENIZER_PROXY_CONTROL_PLANE_API_BASE_URL:
            CONTROL_PLANE_API_CONTAINER_BASE_URL,
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
          MISTLE_APPS_DATA_PLANE_WORKER_DATABASE_URL: containerDatabaseUrl,
          MISTLE_APPS_DATA_PLANE_WORKER_WORKFLOW_DATABASE_URL: containerDatabaseUrl,
          MISTLE_APPS_DATA_PLANE_WORKER_WORKFLOW_NAMESPACE_ID: input.dataPlaneWorkflowNamespaceId,
          MISTLE_APPS_DATA_PLANE_WORKER_WORKFLOW_RUN_MIGRATIONS: "false",
          MISTLE_APPS_DATA_PLANE_WORKER_RUNTIME_STATE_GATEWAY_BASE_URL:
            DATA_PLANE_GATEWAY_CONTAINER_BASE_URL,
          MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_DOCKER_SOCKET_PATH: "/var/run/docker.sock",
          MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_DOCKER_SNAPSHOT_REPOSITORY:
            sandboxSnapshotRepository,
          MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_DOCKER_NETWORK_NAME: activeNetwork.getName(),
          MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_DOCKER_TRACES_ENDPOINT:
            "http://otel-lgtm:4318/v1/traces",
          MISTLE_GLOBAL_SANDBOX_PROVIDER: "docker",
          MISTLE_GLOBAL_SANDBOX_GATEWAY_WS_URL: DATA_PLANE_GATEWAY_TUNNEL_WS_URL,
          MISTLE_GLOBAL_SANDBOX_INTERNAL_GATEWAY_WS_URL: DATA_PLANE_GATEWAY_TUNNEL_WS_URL,
          MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_TOKENIZER_PROXY_EGRESS_BASE_URL:
            TOKENIZER_PROXY_EGRESS_CONTAINER_BASE_URL,
        },
      });
    });
    cleanupTasks.unshift(async () => {
      await dataPlaneWorker.stop();
    });

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

export { createControlPlaneIntegrationTargetsSyncCommandInput, resolveHostPathFromContainerPath };

export const FullSystemContainerBaseUrls = {
  CONTROL_PLANE_API: CONTROL_PLANE_API_CONTAINER_BASE_URL,
  DATA_PLANE_API: DATA_PLANE_API_CONTAINER_BASE_URL,
  DATA_PLANE_GATEWAY: DATA_PLANE_GATEWAY_CONTAINER_BASE_URL,
  TOKENIZER_PROXY: TOKENIZER_PROXY_CONTAINER_BASE_URL,
} as const;
