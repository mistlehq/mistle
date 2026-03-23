import { createEnvLoader, hasEntries, parseBooleanEnv } from "../../core/load-env.js";
import {
  type PartialDataPlaneWorkerConfigInput,
  DataPlaneWorkerDatabaseConfigSchema,
  PartialDataPlaneWorkerRuntimeStateConfigSchema,
  DataPlaneWorkerSandboxDockerConfigSchema,
  DataPlaneWorkerSandboxModalConfigSchema,
  DataPlaneWorkerTunnelConfigSchema,
  DataPlaneWorkerWorkflowConfigSchema,
  PartialDataPlaneWorkerConfigSchema,
  PartialDataPlaneWorkerSandboxConfigSchema,
} from "./schema.js";

const loadDatabaseEnv = createEnvLoader<typeof DataPlaneWorkerDatabaseConfigSchema>([
  {
    key: "url",
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_DATABASE_URL",
  },
]);

const loadWorkflowEnv = createEnvLoader<typeof DataPlaneWorkerWorkflowConfigSchema>([
  {
    key: "databaseUrl",
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_WORKFLOW_DATABASE_URL",
  },
  {
    key: "namespaceId",
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_WORKFLOW_NAMESPACE_ID",
  },
  {
    key: "runMigrations",
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_WORKFLOW_RUN_MIGRATIONS",
    parse: (value) =>
      parseBooleanEnv(value, "MISTLE_APPS_DATA_PLANE_WORKER_WORKFLOW_RUN_MIGRATIONS"),
  },
  {
    key: "concurrency",
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_WORKFLOW_CONCURRENCY",
    parse: Number,
  },
]);

const loadTunnelEnv = createEnvLoader<typeof DataPlaneWorkerTunnelConfigSchema>([
  {
    key: "bootstrapTokenTtlSeconds",
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_TUNNEL_BOOTSTRAP_TOKEN_TTL_SECONDS",
    parse: Number,
  },
  {
    key: "exchangeTokenTtlSeconds",
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_TUNNEL_EXCHANGE_TOKEN_TTL_SECONDS",
    parse: Number,
  },
]);

const loadRuntimeStateEnv = createEnvLoader<typeof PartialDataPlaneWorkerRuntimeStateConfigSchema>([
  {
    key: "gatewayBaseUrl",
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_RUNTIME_STATE_GATEWAY_BASE_URL",
  },
]);

const loadSandboxModalEnv = createEnvLoader<typeof DataPlaneWorkerSandboxModalConfigSchema>([
  {
    key: "tokenId",
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_MODAL_TOKEN_ID",
  },
  {
    key: "tokenSecret",
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_MODAL_TOKEN_SECRET",
  },
  {
    key: "appName",
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_MODAL_APP_NAME",
  },
  {
    key: "environmentName",
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_MODAL_ENVIRONMENT_NAME",
  },
]);

const loadSandboxDockerEnv = createEnvLoader<typeof DataPlaneWorkerSandboxDockerConfigSchema>([
  {
    key: "socketPath",
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_DOCKER_SOCKET_PATH",
  },
  {
    key: "networkName",
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_DOCKER_NETWORK_NAME",
  },
  {
    key: "tracesEndpoint",
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_DOCKER_TRACES_ENDPOINT",
  },
]);

const loadSandboxEnv = createEnvLoader<typeof PartialDataPlaneWorkerSandboxConfigSchema>([
  {
    key: "tokenizerProxyEgressBaseUrl",
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_TOKENIZER_PROXY_EGRESS_BASE_URL",
  },
]);

export function loadDataPlaneWorkerFromEnv(
  env: NodeJS.ProcessEnv,
): PartialDataPlaneWorkerConfigInput {
  const partialConfig: PartialDataPlaneWorkerConfigInput = {};

  const database = loadDatabaseEnv(env);
  if (hasEntries(database)) {
    partialConfig.database = database;
  }

  const workflow = loadWorkflowEnv(env);
  if (hasEntries(workflow)) {
    partialConfig.workflow = workflow;
  }

  const tunnel = loadTunnelEnv(env);
  if (hasEntries(tunnel)) {
    partialConfig.tunnel = tunnel;
  }

  const runtimeState = loadRuntimeStateEnv(env);
  if (hasEntries(runtimeState)) {
    partialConfig.runtimeState = runtimeState;
  }

  const sandbox = loadSandboxEnv(env);
  const sandboxModal = loadSandboxModalEnv(env);
  const sandboxDocker = loadSandboxDockerEnv(env);

  if (hasEntries(sandbox) || hasEntries(sandboxModal) || hasEntries(sandboxDocker)) {
    const sandboxConfig: Record<string, unknown> = {
      ...sandbox,
    };

    if (hasEntries(sandboxModal)) {
      sandboxConfig.modal = sandboxModal;
    }
    if (hasEntries(sandboxDocker)) {
      sandboxConfig.docker = sandboxDocker;
    }

    partialConfig.sandbox = sandboxConfig;
  }

  return PartialDataPlaneWorkerConfigSchema.parse(partialConfig);
}
