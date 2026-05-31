import { fileURLToPath } from "node:url";

import { AppIds, getLocalDevDockerRegistrySandboxBaseImageRef, loadConfig } from "@mistle/config";
import { BackendPostgres } from "openworkflow/postgres";

import { DataPlaneOpenWorkflowSchema } from "../../../../../apps/data-plane-worker/openworkflow/core/client.js";
import {
  createHostedWorkflowContext,
  withHostedWorkflowContext,
} from "../../../../../apps/data-plane-worker/openworkflow/core/context.js";
import { withHostedOpenWorkflowRuntime } from "../../../../../apps/data-plane-worker/openworkflow/core/runtime.js";
import { DataPlaneWorkerWorkflows } from "../../../../../apps/data-plane-worker/openworkflow/workflows.js";
import { runCleanupTasks } from "../../cleanup/index.js";
import type {
  ResolvedTestInfra,
  TestInfraRequirement,
  TestService,
  TestServiceDefinition,
  TestServiceStartInput,
} from "../../environment/index.js";
import {
  TestEnvironmentIdHeader,
  createDataPlaneWorkflowNamespaceId,
} from "../../environment/test-isolation.js";
import { createDockerSandboxReachableHostUrl } from "../../system/docker-sandbox-networking.js";
import { startHostedOpenWorkflowWorker } from "./openworkflow-worker-host.js";
import type { IntegrationServiceOptions, IntegrationSandboxOptions } from "./options.js";
import { peers } from "./peers.js";
import { leasePgPool, leasePostgresJsPool } from "./postgres-pools.js";
import { ServiceIds } from "./service-ids.js";
import {
  assertMode,
  infraRequirement,
  infraValue,
  processHealth,
  processService,
  resolvedInfra,
} from "./shared.js";

const AppDir = fileURLToPath(new URL("../../../../../apps/data-plane-worker", import.meta.url));
const DockerSocketPath = "/var/run/docker.sock";

const PostgresValues = {
  HOST_DIRECT_URL: "host.directUrl",
  HOST_POOLED_URL: "host.pooledUrl",
};

const InfraIds = {
  POSTGRES: "postgres.data-plane",
  SANDBOX_BASE_IMAGE: "sandbox-base-image",
  SANDBOX_DOCKER_NETWORK: "sandbox-docker-network",
};

const DockerNetworkValues = {
  NETWORK_NAME: "network.name",
};

const SandboxBaseImageValues = {
  IMAGE_REF: "image.ref",
};

export function service(
  infra: readonly TestInfraRequirement[],
  options: IntegrationServiceOptions,
): TestServiceDefinition {
  return {
    id: ServiceIds.DATA_PLANE_WORKER,
    infra,
    serviceReferences: [ServiceIds.DATA_PLANE_GATEWAY, ServiceIds.CONTROL_PLANE_API],
    poolScope: "environment",
    supportedModes: ["runtime", "process"],
    healthCheck: async (runtime) => processHealth(runtime, ServiceIds.DATA_PLANE_WORKER),
    start: start({
      postgresInfra: infraRequirement(infra, InfraIds.POSTGRES, ServiceIds.DATA_PLANE_WORKER),
      sandbox: options.sandbox,
      options: options.dataPlaneWorker,
    }),
  };
}

function start(input: {
  postgresInfra: TestInfraRequirement;
  sandbox: IntegrationSandboxOptions | undefined;
  options: IntegrationServiceOptions["dataPlaneWorker"] | undefined;
}): (startInput: TestServiceStartInput) => Promise<TestService> {
  return async (startInput) => {
    const postgres = resolvedInfra(startInput.infra, input.postgresInfra.id);
    const peer = peers(startInput.services, startInput.plannedEndpoints);
    const sandboxBaseImage = startInput.infra.get(InfraIds.SANDBOX_BASE_IMAGE);
    const sandboxDockerNetwork = startInput.infra.get(InfraIds.SANDBOX_DOCKER_NETWORK);
    const sandboxEndpoints = await createSandboxReachableEndpoints({
      environmentId: startInput.environmentId,
      peer,
      sandboxDockerNetwork,
      sandbox: input.sandbox,
    });

    if (startInput.mode === "runtime") {
      return startRuntimeDataPlaneWorker({
        startInput,
        postgres,
        sandboxBaseImage,
        sandboxEndpoints,
        sandbox: input.sandbox,
        options: input.options,
      });
    }

    assertMode(startInput.mode, "process", ServiceIds.DATA_PLANE_WORKER);

    const env = createDataPlaneWorkerEnv({
      environmentId: startInput.environmentId,
      postgres,
      sandboxBaseImage,
      sandboxEndpoints,
      peer,
      sandbox: input.sandbox,
    });

    return processService({
      id: ServiceIds.DATA_PLANE_WORKER,
      mode: startInput.mode,
      cwd: AppDir,
      command: process.execPath,
      args: [
        "--import",
        "tsx",
        "./node_modules/@openworkflow/cli/dist/cli.js",
        "worker",
        "start",
        "--config",
        "./openworkflow.config.ts",
      ],
      env,
    });
  };
}

async function startRuntimeDataPlaneWorker(input: {
  startInput: TestServiceStartInput;
  postgres: ResolvedTestInfra;
  sandboxBaseImage: ResolvedTestInfra | undefined;
  sandboxEndpoints: SandboxReachableEndpoints;
  sandbox: IntegrationSandboxOptions | undefined;
  options: IntegrationServiceOptions["dataPlaneWorker"] | undefined;
}): Promise<TestService> {
  const peer = peers(input.startInput.services, input.startInput.plannedEndpoints);
  const env = createDataPlaneWorkerEnv({
    environmentId: input.startInput.environmentId,
    postgres: input.postgres,
    sandboxBaseImage: input.sandboxBaseImage,
    peer,
    sandboxEndpoints: input.sandboxEndpoints,
    sandbox: input.sandbox,
  });
  const loadedConfig = loadConfig({
    app: AppIds.DATA_PLANE_WORKER,
    env,
  });
  if (loadedConfig.global === undefined) {
    throw new Error("Expected global config to be loaded for data-plane worker test runtime.");
  }
  const config = loadedConfig.app;
  const appDatabaseUrl = infraValue(input.postgres, PostgresValues.HOST_POOLED_URL);
  const workflowDatabaseUrl = infraValue(input.postgres, PostgresValues.HOST_DIRECT_URL);
  const workflowNamespaceId = createDataPlaneWorkflowNamespaceId(input.startInput.environmentId);
  const workflowPool = leasePostgresJsPool({
    key: `${ServiceIds.DATA_PLANE_WORKER}:openworkflow:${workflowDatabaseUrl}`,
    url: workflowDatabaseUrl,
    max: Math.max(4, config.workflow.concurrency),
    applicationName: "mistle_integration_data_plane_worker_openworkflow",
  });
  const appDbPool = leasePgPool({
    key: `${ServiceIds.DATA_PLANE_WORKER}:app:${appDatabaseUrl}`,
    connectionString: appDatabaseUrl,
    max: Math.max(4, config.workflow.concurrency),
    applicationName: "mistle_integration_data_plane_worker_app",
  });
  const backend = BackendPostgres.fromPool(workflowPool.value, {
    namespaceId: workflowNamespaceId,
    schema: DataPlaneOpenWorkflowSchema,
  });
  const runtime = {
    backend,
    workerConfig: config,
    environment:
      input.options?.sandboxdArtifactResolver === "release"
        ? "production"
        : loadedConfig.global.env,
  };
  const hostedContext = await createHostedWorkflowContext({
    runtime,
    testIsolation: {
      testEnvironmentId: input.startInput.environmentId,
      testEnvironmentIdHeader: TestEnvironmentIdHeader,
    },
    dbPool: appDbPool.value,
    processEnv: env,
  });
  const worker = await startHostedOpenWorkflowWorker({
    backendPool: workflowPool.value,
    namespaceId: workflowNamespaceId,
    schema: DataPlaneOpenWorkflowSchema,
    workflows: DataPlaneWorkerWorkflows,
    concurrency: config.workflow.concurrency,
    runWithContext: (callback) =>
      withHostedOpenWorkflowRuntime(runtime, () =>
        withHostedWorkflowContext(hostedContext.context, callback),
      ),
  });

  return {
    id: ServiceIds.DATA_PLANE_WORKER,
    mode: input.startInput.mode,
    endpoints: {},
    pid: process.pid,
    stop: async () => {
      await runCleanupTasks({
        tasks: [worker.stop, hostedContext.close, appDbPool.release, workflowPool.release],
        context: "runtime data-plane worker cleanup",
      });
    },
  };
}

function createDataPlaneWorkerEnv(input: {
  environmentId: string;
  postgres: ReturnType<typeof resolvedInfra>;
  sandboxBaseImage: ResolvedTestInfra | undefined;
  peer: ReturnType<typeof peers>;
  sandboxEndpoints: SandboxReachableEndpoints;
  sandbox: IntegrationSandboxOptions | undefined;
}): Record<string, string> {
  const provider = input.sandbox?.provider ?? "docker";
  return {
    MISTLE_ENV: "development",
    NODE_ENV: "development",
    MISTLE_POSTGRES_DATA_PLANE_POOLED_URL: infraValue(
      input.postgres,
      PostgresValues.HOST_POOLED_URL,
    ),
    MISTLE_POSTGRES_DATA_PLANE_DIRECT_URL: infraValue(
      input.postgres,
      PostgresValues.HOST_DIRECT_URL,
    ),
    MISTLE_WORKFLOW_DATA_PLANE_NAMESPACE_ID: createDataPlaneWorkflowNamespaceId(
      input.environmentId,
    ),
    MISTLE_TEST_ENVIRONMENT_ID: input.environmentId,
    MISTLE_TEST_ENVIRONMENT_ID_HEADER: TestEnvironmentIdHeader,
    MISTLE_SERVICES_DATA_PLANE_WORKER_WORKFLOW_CONCURRENCY: "2",
    MISTLE_SERVICES_DATA_PLANE_WORKER_WORKFLOW_DATABASE_POOL_MAX: "2",
    MISTLE_SERVICES_DATA_PLANE_GATEWAY_INTERNAL_URL: input.peer.url(ServiceIds.DATA_PLANE_GATEWAY),
    MISTLE_SERVICES_DATA_PLANE_GATEWAY_SANDBOX_WS_INTERNAL_URL: input.sandboxEndpoints.gatewayWsUrl,
    MISTLE_SERVICES_CONTROL_PLANE_API_INTERNAL_URL: input.peer.url(ServiceIds.CONTROL_PLANE_API),
    MISTLE_INTERNAL_AUTH_SHARED_TOKEN: "integration-new-internal-service-token",
    MISTLE_SANDBOX_DEFAULT_BASE_IMAGE: readSandboxBaseImageRef({
      sandbox: input.sandbox,
      sandboxBaseImage: input.sandboxBaseImage,
    }),
    MISTLE_SERVICES_DATA_PLANE_GATEWAY_SANDBOX_WS_PUBLIC_URL: input.sandboxEndpoints.gatewayWsUrl,
    ...(provider === "docker"
      ? {
          MISTLE_SANDBOX_STORAGE_BACKEND: "docker_volume",
          MISTLE_SANDBOX_STORAGE_DOCKER_VOLUME_NAME_PREFIX: `${input.environmentId}-`,
          MISTLE_SANDBOX_DOCKER_ENABLED: "true",
          MISTLE_SANDBOX_DOCKER_SOCKET_PATH: DockerSocketPath,
        }
      : provider === "e2b"
        ? { MISTLE_SANDBOX_DOCKER_ENABLED: "false", ...createE2BEnv(input.sandbox) }
        : { MISTLE_SANDBOX_DOCKER_ENABLED: "false", ...createTensorlakeEnv(input.sandbox) }),
    ...(input.sandboxEndpoints.dockerNetworkName === undefined
      ? {}
      : {
          MISTLE_SANDBOX_DOCKER_NETWORK_NAME: input.sandboxEndpoints.dockerNetworkName,
        }),
    MISTLE_SANDBOX_TOKENS_CONNECT_SECRET: "integration-new-connection-secret",
    MISTLE_SANDBOX_TOKENS_CONNECT_ISSUER: "integration-new-control-plane-api",
    MISTLE_SANDBOX_TOKENS_CONNECT_AUDIENCE: "integration-new-data-plane-gateway",
    MISTLE_SANDBOX_TOKENS_BOOTSTRAP_SECRET: "integration-new-bootstrap-token-secret",
    MISTLE_SANDBOX_TOKENS_BOOTSTRAP_ISSUER: "integration-new-data-plane-worker",
    MISTLE_SANDBOX_TOKENS_BOOTSTRAP_AUDIENCE: "integration-new-data-plane-gateway",
    MISTLE_SANDBOX_TOKENS_EGRESS_SECRET: "integration-new-egress-token-secret",
    MISTLE_SANDBOX_TOKENS_EGRESS_ISSUER: "integration-new-data-plane-gateway",
    MISTLE_SANDBOX_TOKENS_EGRESS_AUDIENCE: "integration-new-gateway-egress",
    MISTLE_SANDBOX_TOKENS_PTY_TRANSPORT_SECRET: "integration-new-pty-token-secret",
    MISTLE_SANDBOX_TOKENS_PTY_TRANSPORT_ISSUER: "integration-new-data-plane-gateway",
    MISTLE_SANDBOX_TOKENS_PTY_TRANSPORT_AUDIENCE: "integration-new-gateway-pty",
    MISTLE_SANDBOX_PUBLISH_BASE_DOMAIN: "mistle.example.test",
    MISTLE_SANDBOX_PUBLISH_ACCESS_TOKEN_SECRET: "integration-new-port-access-secret",
    MISTLE_SANDBOX_PUBLISH_ACCESS_TOKEN_ISSUER: "integration-new-control-plane-api",
    MISTLE_SANDBOX_PUBLISH_ACCESS_TOKEN_AUDIENCE: "integration-new-data-plane-gateway",
    MISTLE_SANDBOX_PUBLISH_SESSION_COOKIE_SIGNING_SECRET:
      "integration-new-port-access-cookie-secret",
    MISTLE_TELEMETRY_ENABLED: "false",
    MISTLE_TELEMETRY_DEBUG: "false",
  };
}

type SandboxReachableEndpoints = {
  gatewayWsUrl: string;
  dockerNetworkName?: string;
};

async function createSandboxReachableEndpoints(input: {
  environmentId: string;
  peer: ReturnType<typeof peers>;
  sandboxDockerNetwork: ResolvedTestInfra | undefined;
  sandbox: IntegrationSandboxOptions | undefined;
}): Promise<SandboxReachableEndpoints> {
  const gatewayWsUrl = withTestEnvironmentIdQueryParam({
    url: input.peer.ws(ServiceIds.DATA_PLANE_GATEWAY, "/tunnel/sandbox"),
    environmentId: input.environmentId,
  });
  if (requiresPublicSandboxReachableEndpoints(input.sandbox)) {
    return createPublicSandboxReachableEndpoints({
      environmentId: input.environmentId,
      sandbox: input.sandbox,
    });
  }

  if (input.sandboxDockerNetwork === undefined) {
    return {
      gatewayWsUrl,
    };
  }

  const sandboxGatewayWsUrl = createDockerSandboxReachableHostUrl(gatewayWsUrl);
  readUrlPort(sandboxGatewayWsUrl, "data-plane gateway sandbox websocket URL");

  return {
    gatewayWsUrl: sandboxGatewayWsUrl,
    dockerNetworkName: infraValue(input.sandboxDockerNetwork, DockerNetworkValues.NETWORK_NAME),
  };
}

export function requiresPublicSandboxReachableEndpoints(
  input: IntegrationSandboxOptions | undefined,
): input is IntegrationSandboxOptions & { provider: "e2b" | "tensorlake" } {
  return input?.provider === "e2b" || input?.provider === "tensorlake";
}

function createPublicSandboxReachableEndpoints(input: {
  environmentId: string;
  sandbox: IntegrationSandboxOptions;
}): SandboxReachableEndpoints {
  const publicGatewayBaseUrl = input.sandbox.publicServiceBaseUrls?.get(
    ServiceIds.DATA_PLANE_GATEWAY,
  );
  if (publicGatewayBaseUrl === undefined) {
    throw new Error(
      `${input.sandbox.provider} runtime system tests require public access for data-plane-gateway.`,
    );
  }

  return {
    gatewayWsUrl: withTestEnvironmentIdQueryParam({
      url: createPublicGatewayWsUrl(publicGatewayBaseUrl),
      environmentId: input.environmentId,
    }),
  };
}

function readSandboxBaseImageRef(input: {
  sandbox: IntegrationSandboxOptions | undefined;
  sandboxBaseImage: ResolvedTestInfra | undefined;
}): string {
  if (input.sandbox?.defaultBaseImageRef !== undefined) {
    return input.sandbox.defaultBaseImageRef;
  }

  if (input.sandboxBaseImage !== undefined) {
    return infraValue(input.sandboxBaseImage, SandboxBaseImageValues.IMAGE_REF);
  }

  return getLocalDevDockerRegistrySandboxBaseImageRef();
}

function createTensorlakeEnv(input: IntegrationSandboxOptions | undefined): Record<string, string> {
  if (input?.tensorlake === undefined) {
    throw new Error(
      "data-plane-worker requires Tensorlake sandbox options when provider is tensorlake.",
    );
  }

  return {
    MISTLE_SANDBOX_TENSORLAKE_ENABLED: "true",
    MISTLE_SANDBOX_TENSORLAKE_API_KEY: input.tensorlake.apiKey,
  };
}

function createE2BEnv(input: IntegrationSandboxOptions | undefined): Record<string, string> {
  if (input?.e2b === undefined) {
    throw new Error("data-plane-worker requires E2B sandbox options when provider is e2b.");
  }

  return {
    MISTLE_SANDBOX_E2B_ENABLED: "true",
    MISTLE_SANDBOX_E2B_API_KEY: input.e2b.apiKey,
    ...(input.e2b.domain === undefined ? {} : { MISTLE_SANDBOX_E2B_DOMAIN: input.e2b.domain }),
    ...(input.e2b.cpuCount === undefined
      ? {}
      : { MISTLE_SANDBOX_E2B_CPU_COUNT: input.e2b.cpuCount }),
    ...(input.e2b.memoryMb === undefined
      ? {}
      : { MISTLE_SANDBOX_E2B_MEMORY_MB: input.e2b.memoryMb }),
    ...(input.e2b.templateLockDirectoryPath === undefined
      ? {}
      : { MISTLE_SANDBOX_E2B_TEMPLATE_LOCK_DIR: input.e2b.templateLockDirectoryPath }),
  };
}
function createPublicGatewayWsUrl(publicGatewayBaseUrl: string): string {
  const url = new URL("/tunnel/sandbox", publicGatewayBaseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function withTestEnvironmentIdQueryParam(input: { url: string; environmentId: string }): string {
  const url = new URL(input.url);
  url.searchParams.set(TestEnvironmentIdHeader, input.environmentId);
  return url.toString();
}

function readUrlPort(value: string, description: string): number {
  const port = Number(new URL(value).port);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Expected ${description} to include a valid port.`);
  }

  return port;
}
