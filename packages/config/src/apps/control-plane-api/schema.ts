import { z } from "zod";

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

export const ControlPlaneApiAuthConfigSchema = z
  .object({
    baseUrl: z.string().min(1),
    secret: z.string().min(1),
    trustedOrigins: z.array(z.string().min(1)).min(1),
    otpLength: z.number().int().min(4).max(12),
    otpExpiresInSeconds: z.number().int().min(30),
    otpAllowedAttempts: z.number().int().min(1).max(10),
  })
  .strict();

export const ControlPlaneApiDashboardConfigSchema = z
  .object({
    baseUrl: z.string().min(1),
  })
  .strict();

export const ControlPlaneApiWorkflowConfigSchema = z
  .object({
    databaseUrl: z.string().min(1),
    namespaceId: z.string().min(1),
  })
  .strict();

export const ControlPlaneApiDataPlaneApiConfigSchema = z
  .object({
    baseUrl: z.string().min(1),
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
    auth: ControlPlaneApiAuthConfigSchema,
    dashboard: ControlPlaneApiDashboardConfigSchema,
    workflow: ControlPlaneApiWorkflowConfigSchema,
    dataPlaneApi: ControlPlaneApiDataPlaneApiConfigSchema,
    integrations: ControlPlaneApiIntegrationsConfigSchema,
  })
  .strict();

export const PartialControlPlaneApiConfigSchema = z
  .object({
    server: ControlPlaneApiServerConfigSchema.partial().optional(),
    database: ControlPlaneApiDatabaseConfigSchema.partial().optional(),
    auth: ControlPlaneApiAuthConfigSchema.partial().optional(),
    dashboard: ControlPlaneApiDashboardConfigSchema.partial().optional(),
    workflow: ControlPlaneApiWorkflowConfigSchema.partial().optional(),
    dataPlaneApi: ControlPlaneApiDataPlaneApiConfigSchema.partial().optional(),
    integrations: ControlPlaneApiIntegrationsConfigObjectSchema.partial().optional(),
  })
  .strict();

export type ControlPlaneApiConfig = z.infer<typeof ControlPlaneApiConfigSchema>;
export type PartialControlPlaneApiConfigInput = z.input<typeof PartialControlPlaneApiConfigSchema>;
