import { createEnvLoader, parseBooleanEnv } from "../../core/load-env.js";
import {
  ControlPlaneWorkerControlPlaneApiConfigSchema,
  ControlPlaneWorkerDataPlaneApiConfigSchema,
  ControlPlaneWorkerEmailConfigSchema,
  ControlPlaneWorkerWorkflowConfigSchema,
} from "./schema.js";

export const ControlPlaneWorkerWorkflowEnvDescriptors = [
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
] satisfies Parameters<typeof createEnvLoader<typeof ControlPlaneWorkerWorkflowConfigSchema>>[0];

export const ControlPlaneWorkerEmailEnvDescriptors = [
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
] satisfies Parameters<typeof createEnvLoader<typeof ControlPlaneWorkerEmailConfigSchema>>[0];

export const ControlPlaneWorkerDataPlaneApiEnvDescriptors = [
  {
    key: "baseUrl",
    envVar: "MISTLE_APPS_CONTROL_PLANE_WORKER_DATA_PLANE_API_BASE_URL",
  },
] satisfies Parameters<
  typeof createEnvLoader<typeof ControlPlaneWorkerDataPlaneApiConfigSchema>
>[0];

export const ControlPlaneWorkerControlPlaneApiEnvDescriptors = [
  {
    key: "baseUrl",
    envVar: "MISTLE_APPS_CONTROL_PLANE_WORKER_CONTROL_PLANE_API_BASE_URL",
  },
] satisfies Parameters<
  typeof createEnvLoader<typeof ControlPlaneWorkerControlPlaneApiConfigSchema>
>[0];
