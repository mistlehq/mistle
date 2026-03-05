import { createEnvLoader, hasEntries, parseBooleanEnv } from "../../core/load-env.js";
import {
  type PartialDataPlaneWorkerConfigInput,
  DataPlaneWorkerDatabaseConfigSchema,
  DataPlaneWorkerSandboxConfigSchema,
  DataPlaneWorkerSandboxDockerConfigSchema,
  DataPlaneWorkerSandboxModalConfigSchema,
  DataPlaneWorkerSandboxProviders,
  DataPlaneWorkerServerConfigSchema,
  DataPlaneWorkerTunnelConfigSchema,
  DataPlaneWorkerWorkflowConfigSchema,
  PartialDataPlaneWorkerConfigSchema,
} from "./schema.js";

const loadServerEnv = createEnvLoader<typeof DataPlaneWorkerServerConfigSchema>([
  {
    key: "host",
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_HOST",
  },
  {
    key: "port",
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_PORT",
    parse: Number,
  },
]);

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
    key: "snapshotRepository",
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_DOCKER_SNAPSHOT_REPOSITORY",
  },
]);

const loadSandboxEnv = createEnvLoader<typeof DataPlaneWorkerSandboxConfigSchema>([
  {
    key: "provider",
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_PROVIDER",
  },
  {
    key: "tokenizerProxyEgressBaseUrl",
    envVar: "MISTLE_APPS_DATA_PLANE_WORKER_SANDBOX_TOKENIZER_PROXY_EGRESS_BASE_URL",
  },
]);

export function loadDataPlaneWorkerFromEnv(
  env: NodeJS.ProcessEnv,
): PartialDataPlaneWorkerConfigInput {
  const partialConfig: PartialDataPlaneWorkerConfigInput = {};

  const server = loadServerEnv(env);
  if (hasEntries(server)) {
    partialConfig.server = server;
  }

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

  const sandbox = loadSandboxEnv(env);
  const sandboxModal = loadSandboxModalEnv(env);
  const sandboxDocker = loadSandboxDockerEnv(env);

  if (hasEntries(sandbox) || hasEntries(sandboxModal) || hasEntries(sandboxDocker)) {
    const sandboxConfig: PartialDataPlaneWorkerConfigInput["sandbox"] = {
      ...sandbox,
    };

    if (sandbox.provider === DataPlaneWorkerSandboxProviders.MODAL && hasEntries(sandboxModal)) {
      sandboxConfig.modal = sandboxModal;
    } else if (
      sandbox.provider === DataPlaneWorkerSandboxProviders.DOCKER &&
      hasEntries(sandboxDocker)
    ) {
      sandboxConfig.docker = sandboxDocker;
    } else if (sandbox.provider === undefined) {
      if (hasEntries(sandboxModal)) {
        sandboxConfig.modal = sandboxModal;
      }
      if (hasEntries(sandboxDocker)) {
        sandboxConfig.docker = sandboxDocker;
      }
    }

    partialConfig.sandbox = sandboxConfig;
  }

  return PartialDataPlaneWorkerConfigSchema.parse(partialConfig);
}
