import { createEnvLoader, hasEntries, parseBooleanEnv } from "../../core/load-env.js";
import {
  ControlPlaneWorkerDataPlaneApiConfigSchema,
  type PartialControlPlaneWorkerConfigInput,
  ControlPlaneWorkerEmailConfigSchema,
  ControlPlaneWorkerServerConfigSchema,
  ControlPlaneWorkerWorkflowConfigSchema,
  PartialControlPlaneWorkerConfigSchema,
} from "./schema.js";

const loadServerEnv = createEnvLoader<typeof ControlPlaneWorkerServerConfigSchema>([
  {
    key: "host",
    envVar: "MISTLE_APPS_CONTROL_PLANE_WORKER_HOST",
  },
  {
    key: "port",
    envVar: "MISTLE_APPS_CONTROL_PLANE_WORKER_PORT",
    parse: Number,
  },
]);

const loadWorkflowEnv = createEnvLoader<typeof ControlPlaneWorkerWorkflowConfigSchema>([
  {
    key: "databaseUrl",
    envVar: "MISTLE_APPS_CONTROL_PLANE_WORKER_WORKFLOW_DATABASE_URL",
  },
  {
    key: "namespaceId",
    envVar: "MISTLE_APPS_CONTROL_PLANE_WORKER_WORKFLOW_NAMESPACE_ID",
  },
  {
    key: "runMigrations",
    envVar: "MISTLE_APPS_CONTROL_PLANE_WORKER_WORKFLOW_RUN_MIGRATIONS",
    parse: (value) =>
      parseBooleanEnv(value, "MISTLE_APPS_CONTROL_PLANE_WORKER_WORKFLOW_RUN_MIGRATIONS"),
  },
  {
    key: "concurrency",
    envVar: "MISTLE_APPS_CONTROL_PLANE_WORKER_WORKFLOW_CONCURRENCY",
    parse: Number,
  },
]);

const loadEmailEnv = createEnvLoader<typeof ControlPlaneWorkerEmailConfigSchema>([
  {
    key: "fromAddress",
    envVar: "MISTLE_APPS_CONTROL_PLANE_WORKER_EMAIL_FROM_ADDRESS",
  },
  {
    key: "fromName",
    envVar: "MISTLE_APPS_CONTROL_PLANE_WORKER_EMAIL_FROM_NAME",
  },
  {
    key: "smtpHost",
    envVar: "MISTLE_APPS_CONTROL_PLANE_WORKER_SMTP_HOST",
  },
  {
    key: "smtpPort",
    envVar: "MISTLE_APPS_CONTROL_PLANE_WORKER_SMTP_PORT",
    parse: Number,
  },
  {
    key: "smtpSecure",
    envVar: "MISTLE_APPS_CONTROL_PLANE_WORKER_SMTP_SECURE",
    parse: (value) => parseBooleanEnv(value, "MISTLE_APPS_CONTROL_PLANE_WORKER_SMTP_SECURE"),
  },
  {
    key: "smtpUsername",
    envVar: "MISTLE_APPS_CONTROL_PLANE_WORKER_SMTP_USERNAME",
  },
  {
    key: "smtpPassword",
    envVar: "MISTLE_APPS_CONTROL_PLANE_WORKER_SMTP_PASSWORD",
  },
]);

const loadDataPlaneApiEnv = createEnvLoader<typeof ControlPlaneWorkerDataPlaneApiConfigSchema>([
  {
    key: "baseUrl",
    envVar: "MISTLE_APPS_CONTROL_PLANE_WORKER_DATA_PLANE_API_BASE_URL",
  },
]);

export function loadControlPlaneWorkerFromEnv(
  env: NodeJS.ProcessEnv,
): PartialControlPlaneWorkerConfigInput {
  const partialConfig: PartialControlPlaneWorkerConfigInput = {};

  const server = loadServerEnv(env);
  if (hasEntries(server)) {
    partialConfig.server = server;
  }

  const workflow = loadWorkflowEnv(env);
  if (hasEntries(workflow)) {
    partialConfig.workflow = workflow;
  }

  const email = loadEmailEnv(env);
  if (hasEntries(email)) {
    partialConfig.email = email;
  }

  const dataPlaneApi = loadDataPlaneApiEnv(env);
  if (hasEntries(dataPlaneApi)) {
    partialConfig.dataPlaneApi = dataPlaneApi;
  }

  return PartialControlPlaneWorkerConfigSchema.parse(partialConfig);
}
