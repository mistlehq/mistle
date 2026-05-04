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
  TestInfraRequirement,
  TestService,
  TestServiceDefinition,
  TestServiceStartInput,
} from "../../environment/index.js";
import {
  TestEnvironmentIdHeader,
  createDataPlaneWorkflowNamespaceId,
} from "../../environment/test-isolation.js";
import { startHostedOpenWorkflowWorker } from "./openworkflow-worker-host.js";
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
};

export function service(infra: readonly TestInfraRequirement[]): TestServiceDefinition {
  return {
    id: ServiceIds.DATA_PLANE_WORKER,
    infra,
    serviceReferences: [
      ServiceIds.DATA_PLANE_GATEWAY,
      ServiceIds.TOKENIZER_PROXY,
      ServiceIds.CONTROL_PLANE_API,
    ],
    poolScope: "environment",
    supportedModes: ["runtime", "process"],
    healthCheck: async (runtime) => processHealth(runtime, ServiceIds.DATA_PLANE_WORKER),
    start: start({
      postgresInfra: infraRequirement(infra, InfraIds.POSTGRES, ServiceIds.DATA_PLANE_WORKER),
    }),
  };
}

function start(input: {
  postgresInfra: TestInfraRequirement;
}): (startInput: TestServiceStartInput) => Promise<TestService> {
  return async (startInput) => {
    if (startInput.mode === "runtime") {
      return startRuntimeDataPlaneWorker({
        startInput,
        postgresInfra: input.postgresInfra,
      });
    }

    assertMode(startInput.mode, "process", ServiceIds.DATA_PLANE_WORKER);

    const postgres = resolvedInfra(startInput.infra, input.postgresInfra.id);
    const peer = peers(startInput.services, startInput.plannedEndpoints);
    const env = createDataPlaneWorkerEnv({
      environmentId: startInput.environmentId,
      postgres,
      peer,
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
  postgresInfra: TestInfraRequirement;
}): Promise<TestService> {
  const postgres = resolvedInfra(input.startInput.infra, input.postgresInfra.id);
  const peer = peers(input.startInput.services, input.startInput.plannedEndpoints);
  const env = createDataPlaneWorkerEnv({
    environmentId: input.startInput.environmentId,
    postgres,
    peer,
  });
  const config = loadConfig({
    app: AppIds.DATA_PLANE_WORKER,
    env,
  }).app;
  const appDatabaseUrl = infraValue(postgres, PostgresValues.HOST_POOLED_URL);
  const workflowDatabaseUrl = infraValue(postgres, PostgresValues.HOST_DIRECT_URL);
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
  };
  const hostedContext = await createHostedWorkflowContext({
    runtime,
    testIsolation: {
      testEnvironmentId: input.startInput.environmentId,
      testEnvironmentIdHeader: TestEnvironmentIdHeader,
    },
    dbPool: appDbPool.value,
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
  peer: ReturnType<typeof peers>;
}): Record<string, string> {
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
    MISTLE_SERVICES_DATA_PLANE_GATEWAY_INTERNAL_URL: input.peer.url(ServiceIds.DATA_PLANE_GATEWAY),
    MISTLE_SERVICES_DATA_PLANE_GATEWAY_SANDBOX_WS_INTERNAL_URL: input.peer.ws(
      ServiceIds.DATA_PLANE_GATEWAY,
      "/tunnel/sandbox",
    ),
    MISTLE_SERVICES_TOKENIZER_PROXY_EGRESS_URL: input.peer.url(ServiceIds.TOKENIZER_PROXY),
    MISTLE_SERVICES_CONTROL_PLANE_API_INTERNAL_URL: input.peer.url(ServiceIds.CONTROL_PLANE_API),
    MISTLE_INTERNAL_AUTH_SHARED_TOKEN: "integration-new-internal-service-token",
    MISTLE_SANDBOX_PROVIDER: "docker",
    MISTLE_SANDBOX_DEFAULT_BASE_IMAGE: getLocalDevDockerRegistrySandboxBaseImageRef(),
    MISTLE_SERVICES_DATA_PLANE_GATEWAY_SANDBOX_WS_PUBLIC_URL: input.peer.ws(
      ServiceIds.DATA_PLANE_GATEWAY,
      "/tunnel/sandbox",
    ),
    MISTLE_SANDBOX_DOCKER_SOCKET_PATH: DockerSocketPath,
    MISTLE_SANDBOX_DOCKER_NETWORK_NAME: "mistle-sandbox-dev",
    MISTLE_SANDBOX_TOKENS_CONNECT_SECRET: "integration-new-connection-secret",
    MISTLE_SANDBOX_TOKENS_CONNECT_ISSUER: "integration-new-control-plane-api",
    MISTLE_SANDBOX_TOKENS_CONNECT_AUDIENCE: "integration-new-data-plane-gateway",
    MISTLE_SANDBOX_TOKENS_BOOTSTRAP_SECRET: "integration-new-bootstrap-token-secret",
    MISTLE_SANDBOX_TOKENS_BOOTSTRAP_ISSUER: "integration-new-data-plane-worker",
    MISTLE_SANDBOX_TOKENS_BOOTSTRAP_AUDIENCE: "integration-new-data-plane-gateway",
    MISTLE_SANDBOX_TOKENS_EGRESS_SECRET: "integration-new-egress-token-secret",
    MISTLE_SANDBOX_TOKENS_EGRESS_ISSUER: "integration-new-data-plane-worker",
    MISTLE_SANDBOX_TOKENS_EGRESS_AUDIENCE: "integration-new-tokenizer-proxy",
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
