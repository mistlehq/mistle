import { z } from "zod";

import {
  GlobalSandboxTokenConfigSchema,
  GlobalTelemetryConfigSchema,
  SandboxStorageBackend,
} from "../../global/schema.js";

const ControlPlaneApiAuthGoogleConfigSchema = z
  .object({
    clientId: z.string().min(1),
    clientSecret: z.string().min(1),
  })
  .strict();

export const ControlPlaneApiServerConfigSchema = z
  .object({
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
  })
  .strict();

export const ControlPlaneApiDatabaseConfigSchema = z
  .object({
    url: z.string().min(1),
    migrationUrl: z.string().min(1),
  })
  .strict();

export const ControlPlaneApiObjectStoreConfigSchema = z
  .object({
    bucketName: z.string().min(1),
    region: z.string().min(1),
    endpoint: z.string().min(1).optional(),
    forcePathStyle: z.boolean().optional(),
    accessKeyId: z.string().min(1),
    secretAccessKey: z.string().min(1),
  })
  .strict();

export const ControlPlaneApiAuthConfigSchema = z
  .object({
    baseUrl: z.string().min(1),
    secret: z.string().min(1),
    trustedOrigins: z.array(z.string().min(1)).min(1),
    otpLength: z.number().int().min(4).max(12),
    otpExpiresInSeconds: z.number().int().min(30),
    otpAllowedAttempts: z.number().int().min(1).max(10),
    google: ControlPlaneApiAuthGoogleConfigSchema.optional(),
  })
  .strict();

export const ControlPlaneApiDashboardConfigSchema = z
  .object({
    baseUrl: z.string().min(1),
  })
  .strict();

const ControlPlaneApiWorkflowConfigObjectSchema = z
  .object({
    databaseUrl: z.string().min(1),
    migrationUrl: z.string().min(1).optional(),
    namespaceId: z.string().min(1),
  })
  .strict();

export const ControlPlaneApiWorkflowConfigSchema =
  ControlPlaneApiWorkflowConfigObjectSchema.transform((workflow) => ({
    ...workflow,
    // Legacy TOML/env only has databaseUrl. Keep that shape working until
    // managed deployments use deployment-owned workflow migration jobs.
    migrationUrl: workflow.migrationUrl ?? workflow.databaseUrl,
  }));

export const ControlPlaneApiDataPlaneApiConfigSchema = z
  .object({
    baseUrl: z.string().min(1),
  })
  .strict();

export const ControlPlaneApiInternalAuthConfigSchema = z
  .object({
    serviceToken: z.string().trim().min(1),
  })
  .strict();

export const ControlPlaneApiConnectionTokenConfigSchema = z
  .object({
    secret: z.string().trim().min(1),
    issuer: z.string().trim().min(1),
    audience: z.string().trim().min(1),
  })
  .strict();

export const ControlPlaneApiPortAccessConfigSchema = z
  .object({
    baseDomain: z.string().trim().min(1),
    gatewayWsUrl: z.string().trim().min(1),
    access: GlobalSandboxTokenConfigSchema,
  })
  .strict();

export const ControlPlaneApiSandboxRuntimeConfigSchema = z
  .object({
    provider: z.enum(["docker", "e2b"]),
    defaultBaseImage: z.string().trim().min(1),
    gatewayWsUrl: z.string().trim().min(1),
    bootstrap: GlobalSandboxTokenConfigSchema.optional(),
    storageBackend: z
      .enum([SandboxStorageBackend.ARCHIL, SandboxStorageBackend.DOCKER_VOLUME])
      .optional(),
  })
  .strict();

export const ControlPlaneApiCommitSignConfigSchema = z
  .object({
    binaryPath: z.string().min(1),
  })
  .strict();

const ControlPlaneApiIntegrationsConfigObjectSchema = z
  .object({
    activeMasterEncryptionKeyVersion: z.number().int().min(1),
    masterEncryptionKeys: z.record(z.string().regex(/^[1-9]\d*$/), z.string().min(1)),
  })
  .strict();

export const ControlPlaneApiIntegrationsConfigSchema =
  ControlPlaneApiIntegrationsConfigObjectSchema.refine(
    (config) => Object.keys(config.masterEncryptionKeys).length > 0,
    {
      message: "At least one master encryption key must be configured.",
      path: ["masterEncryptionKeys"],
    },
  ).refine(
    (config) =>
      Object.prototype.hasOwnProperty.call(
        config.masterEncryptionKeys,
        String(config.activeMasterEncryptionKeyVersion),
      ),
    {
      message: "Active master encryption key version must exist in masterEncryptionKeys.",
      path: ["activeMasterEncryptionKeyVersion"],
    },
  );

export const ControlPlaneApiConfigSchema = z
  .object({
    server: ControlPlaneApiServerConfigSchema,
    database: ControlPlaneApiDatabaseConfigSchema,
    objectStore: ControlPlaneApiObjectStoreConfigSchema,
    auth: ControlPlaneApiAuthConfigSchema,
    dashboard: ControlPlaneApiDashboardConfigSchema,
    workflow: ControlPlaneApiWorkflowConfigSchema,
    dataPlaneApi: ControlPlaneApiDataPlaneApiConfigSchema,
    internalAuth: ControlPlaneApiInternalAuthConfigSchema,
    connectionToken: ControlPlaneApiConnectionTokenConfigSchema,
    portAccess: ControlPlaneApiPortAccessConfigSchema,
    sandbox: ControlPlaneApiSandboxRuntimeConfigSchema,
    commitSign: ControlPlaneApiCommitSignConfigSchema.optional(),
    integrations: ControlPlaneApiIntegrationsConfigSchema,
  })
  .strict();

export const ControlPlaneApiMaintenanceConfigSchema = z
  .object({
    database: z
      .object({
        migrationUrl: z.string().min(1),
      })
      .strict(),
    telemetry: GlobalTelemetryConfigSchema,
  })
  .strict();

export const PartialControlPlaneApiConfigSchema = z
  .object({
    server: ControlPlaneApiServerConfigSchema.partial().optional(),
    database: ControlPlaneApiDatabaseConfigSchema.partial().optional(),
    objectStore: ControlPlaneApiObjectStoreConfigSchema.partial().optional(),
    auth: ControlPlaneApiAuthConfigSchema.partial().optional(),
    dashboard: ControlPlaneApiDashboardConfigSchema.partial().optional(),
    workflow: ControlPlaneApiWorkflowConfigObjectSchema.partial().optional(),
    dataPlaneApi: ControlPlaneApiDataPlaneApiConfigSchema.partial().optional(),
    internalAuth: ControlPlaneApiInternalAuthConfigSchema.partial().optional(),
    connectionToken: ControlPlaneApiConnectionTokenConfigSchema.partial().optional(),
    portAccess: ControlPlaneApiPortAccessConfigSchema.partial().optional(),
    sandbox: ControlPlaneApiSandboxRuntimeConfigSchema.partial().optional(),
    commitSign: ControlPlaneApiCommitSignConfigSchema.partial().optional(),
    integrations: ControlPlaneApiIntegrationsConfigObjectSchema.partial().optional(),
  })
  .strict();

export type ControlPlaneApiConfig = z.infer<typeof ControlPlaneApiConfigSchema>;
export type ControlPlaneApiMaintenanceConfig = z.infer<
  typeof ControlPlaneApiMaintenanceConfigSchema
>;
export type PartialControlPlaneApiConfigInput = z.input<typeof PartialControlPlaneApiConfigSchema>;
