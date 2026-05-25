import { fileURLToPath } from "node:url";

import { AppIds, getLocalDevDockerRegistrySandboxBaseImageRef, loadConfig } from "@mistle/config";
import { BackendPostgres } from "openworkflow/postgres";

import { ControlPlaneOpenWorkflowSchema } from "../../../../../apps/control-plane-worker/openworkflow/core/client.js";
import {
  createHostedWorkflowContext,
  withHostedWorkflowContext,
} from "../../../../../apps/control-plane-worker/openworkflow/core/context.js";
import { withHostedOpenWorkflowRuntime } from "../../../../../apps/control-plane-worker/openworkflow/core/runtime.js";
import { ControlPlaneWorkerWorkflows } from "../../../../../apps/control-plane-worker/openworkflow/workflows.js";
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
  createControlPlaneWorkflowNamespaceId,
} from "../../environment/test-isolation.js";
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

const AppDir = fileURLToPath(new URL("../../../../../apps/control-plane-worker", import.meta.url));

const InfraIds = {
  POSTGRES: "postgres.control-plane",
  MAILPIT: "mailpit",
  SANDBOX_BASE_IMAGE: "sandbox-base-image",
};

const PostgresValues = {
  HOST_DIRECT_URL: "host.directUrl",
  HOST_POOLED_URL: "host.pooledUrl",
};

const MailpitValues = {
  SMTP_HOST: "smtp.host",
  SMTP_PORT: "smtp.port",
};

const SandboxBaseImageValues = {
  IMAGE_REF: "image.ref",
};

export function service(
  infra: readonly TestInfraRequirement[],
  options: IntegrationServiceOptions,
): TestServiceDefinition {
  return {
    id: ServiceIds.CONTROL_PLANE_WORKER,
    infra,
    serviceReferences: [ServiceIds.CONTROL_PLANE_API, ServiceIds.DATA_PLANE_API],
    poolScope: "environment",
    supportedModes: ["runtime", "process"],
    healthCheck: async (runtime) => processHealth(runtime, ServiceIds.CONTROL_PLANE_WORKER),
    start: start({
      postgresInfra: infraRequirement(infra, InfraIds.POSTGRES, ServiceIds.CONTROL_PLANE_WORKER),
      sandbox: options.sandbox,
    }),
  };
}

function start(input: {
  postgresInfra: TestInfraRequirement;
  sandbox: IntegrationSandboxOptions | undefined;
}): (startInput: TestServiceStartInput) => Promise<TestService> {
  return async (startInput) => {
    if (startInput.mode === "runtime") {
      return startRuntimeControlPlaneWorker({
        startInput,
        postgresInfra: input.postgresInfra,
        sandbox: input.sandbox,
      });
    }

    assertMode(startInput.mode, "process", ServiceIds.CONTROL_PLANE_WORKER);

    const postgres = resolvedInfra(startInput.infra, input.postgresInfra.id);
    const mailpit = startInput.infra.get(InfraIds.MAILPIT);
    const sandboxBaseImage = startInput.infra.get(InfraIds.SANDBOX_BASE_IMAGE);
    const peer = peers(startInput.services, startInput.plannedEndpoints);
    const env = createControlPlaneWorkerEnv({
      environmentId: startInput.environmentId,
      postgres,
      mailpit,
      sandboxBaseImage,
      peer,
      sandbox: input.sandbox,
    });

    return processService({
      id: ServiceIds.CONTROL_PLANE_WORKER,
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

async function startRuntimeControlPlaneWorker(input: {
  startInput: TestServiceStartInput;
  postgresInfra: TestInfraRequirement;
  sandbox: IntegrationSandboxOptions | undefined;
}): Promise<TestService> {
  const postgres = resolvedInfra(input.startInput.infra, input.postgresInfra.id);
  const mailpit = input.startInput.infra.get(InfraIds.MAILPIT);
  const sandboxBaseImage = input.startInput.infra.get(InfraIds.SANDBOX_BASE_IMAGE);
  const peer = peers(input.startInput.services, input.startInput.plannedEndpoints);
  const env = createControlPlaneWorkerEnv({
    environmentId: input.startInput.environmentId,
    postgres,
    mailpit,
    sandboxBaseImage,
    peer,
    sandbox: input.sandbox,
  });
  const config = loadConfig({
    app: AppIds.CONTROL_PLANE_WORKER,
    env,
  }).app;
  const appDatabaseUrl = infraValue(postgres, PostgresValues.HOST_POOLED_URL);
  const workflowDatabaseUrl = infraValue(postgres, PostgresValues.HOST_DIRECT_URL);
  const workflowNamespaceId = createControlPlaneWorkflowNamespaceId(input.startInput.environmentId);
  const workflowPool = leasePostgresJsPool({
    key: `${ServiceIds.CONTROL_PLANE_WORKER}:openworkflow:${workflowDatabaseUrl}`,
    url: workflowDatabaseUrl,
    max: Math.max(4, config.workflow.concurrency),
    applicationName: "mistle_integration_control_plane_worker_openworkflow",
  });
  const appDbPool = leasePgPool({
    key: `${ServiceIds.CONTROL_PLANE_WORKER}:app:${appDatabaseUrl}`,
    connectionString: appDatabaseUrl,
    max: Math.max(4, config.workflow.concurrency),
    applicationName: "mistle_integration_control_plane_worker_app",
  });
  const backend = BackendPostgres.fromPool(workflowPool.value, {
    namespaceId: workflowNamespaceId,
    schema: ControlPlaneOpenWorkflowSchema,
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
    schema: ControlPlaneOpenWorkflowSchema,
    workflows: ControlPlaneWorkerWorkflows,
    concurrency: config.workflow.concurrency,
    runWithContext: (callback) =>
      withHostedOpenWorkflowRuntime(runtime, () =>
        withHostedWorkflowContext(hostedContext.context, callback),
      ),
  });

  return {
    id: ServiceIds.CONTROL_PLANE_WORKER,
    mode: input.startInput.mode,
    endpoints: {},
    pid: process.pid,
    stop: async () => {
      await runCleanupTasks({
        tasks: [worker.stop, hostedContext.close, appDbPool.release, workflowPool.release],
        context: "runtime control-plane worker cleanup",
      });
    },
  };
}

function createControlPlaneWorkerEnv(input: {
  environmentId: string;
  postgres: ReturnType<typeof resolvedInfra>;
  mailpit: ReturnType<typeof resolvedInfra> | undefined;
  sandboxBaseImage: ResolvedTestInfra | undefined;
  peer: ReturnType<typeof peers>;
  sandbox: IntegrationSandboxOptions | undefined;
}): Record<string, string> {
  return {
    MISTLE_ENV: "development",
    NODE_ENV: "development",
    MISTLE_POSTGRES_CONTROL_PLANE_POOLED_URL: infraValue(
      input.postgres,
      PostgresValues.HOST_POOLED_URL,
    ),
    MISTLE_POSTGRES_CONTROL_PLANE_DIRECT_URL: infraValue(
      input.postgres,
      PostgresValues.HOST_DIRECT_URL,
    ),
    MISTLE_WORKFLOW_CONTROL_PLANE_NAMESPACE_ID: createControlPlaneWorkflowNamespaceId(
      input.environmentId,
    ),
    MISTLE_TEST_ENVIRONMENT_ID: input.environmentId,
    MISTLE_TEST_ENVIRONMENT_ID_HEADER: TestEnvironmentIdHeader,
    MISTLE_SERVICES_CONTROL_PLANE_WORKER_WORKFLOW_CONCURRENCY: "2",
    MISTLE_SERVICES_CONTROL_PLANE_WORKER_WORKFLOW_DATABASE_POOL_MAX: "2",
    MISTLE_EMAIL_SMTP_FROM_ADDRESS: "integration-new@mistle.test",
    MISTLE_EMAIL_SMTP_FROM_NAME: "Mistle Integration",
    MISTLE_EMAIL_SMTP_HOST:
      input.mailpit === undefined
        ? "127.0.0.1"
        : infraValue(input.mailpit, MailpitValues.SMTP_HOST),
    MISTLE_EMAIL_SMTP_PORT:
      input.mailpit === undefined ? "9" : infraValue(input.mailpit, MailpitValues.SMTP_PORT),
    MISTLE_EMAIL_SMTP_SECURE: "false",
    MISTLE_EMAIL_SMTP_USERNAME: "integration-new",
    MISTLE_EMAIL_SMTP_PASSWORD: "integration-new",
    MISTLE_SERVICES_DATA_PLANE_API_INTERNAL_URL: input.peer.url(ServiceIds.DATA_PLANE_API),
    MISTLE_SERVICES_CONTROL_PLANE_API_INTERNAL_URL: input.peer.url(ServiceIds.CONTROL_PLANE_API),
    MISTLE_INTERNAL_AUTH_SHARED_TOKEN: "integration-new-internal-service-token",
    MISTLE_SANDBOX_DEFAULT_BASE_IMAGE: readSandboxBaseImageRef({
      sandbox: input.sandbox,
      sandboxBaseImage: input.sandboxBaseImage,
    }),
    ...(input.sandbox?.provider === "e2b"
      ? {
          MISTLE_SANDBOX_DOCKER_ENABLED: "false",
          ...createE2BEnv(input.sandbox),
        }
      : { MISTLE_SANDBOX_DOCKER_ENABLED: "true" }),
    MISTLE_SERVICES_DATA_PLANE_GATEWAY_SANDBOX_WS_PUBLIC_URL: input.peer.ws(
      ServiceIds.DATA_PLANE_GATEWAY,
      "/tunnel/sandbox",
    ),
    MISTLE_SERVICES_DATA_PLANE_GATEWAY_SANDBOX_WS_INTERNAL_URL: input.peer.ws(
      ServiceIds.DATA_PLANE_GATEWAY,
      "/tunnel/sandbox",
    ),
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

function createE2BEnv(input: IntegrationSandboxOptions): Record<string, string> {
  if (input.e2b === undefined) {
    throw new Error("control-plane-worker requires E2B sandbox options when provider is e2b.");
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
