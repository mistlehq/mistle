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
  })
  .strict();

export const ControlPlaneApiAuthConfigSchema = z
  .object({
    baseUrl: z.string().min(1),
    invitationAcceptBaseUrl: z.string().min(1),
    secret: z.string().min(1),
    trustedOrigins: z.array(z.string().min(1)).min(1),
    otpLength: z.number().int().min(4).max(12),
    otpExpiresInSeconds: z.number().int().min(30),
    otpAllowedAttempts: z.number().int().min(1).max(10),
  })
  .strict();

export const ControlPlaneApiWorkflowConfigSchema = z
  .object({
    databaseUrl: z.string().min(1),
    namespaceId: z.string().min(1),
  })
  .strict();

export const ControlPlaneApiSandboxConfigSchema = z
  .object({
    defaultBaseImage: z.string().min(1),
  })
  .strict();

export const ControlPlaneApiConfigSchema = z
  .object({
    server: ControlPlaneApiServerConfigSchema,
    database: ControlPlaneApiDatabaseConfigSchema,
    auth: ControlPlaneApiAuthConfigSchema,
    workflow: ControlPlaneApiWorkflowConfigSchema,
    sandbox: ControlPlaneApiSandboxConfigSchema,
  })
  .strict();

export const PartialControlPlaneApiConfigSchema = z
  .object({
    server: ControlPlaneApiServerConfigSchema.partial().optional(),
    database: ControlPlaneApiDatabaseConfigSchema.partial().optional(),
    auth: ControlPlaneApiAuthConfigSchema.partial().optional(),
    workflow: ControlPlaneApiWorkflowConfigSchema.partial().optional(),
    sandbox: ControlPlaneApiSandboxConfigSchema.partial().optional(),
  })
  .strict();

export type ControlPlaneApiConfig = z.infer<typeof ControlPlaneApiConfigSchema>;
export type PartialControlPlaneApiConfigInput = z.input<typeof PartialControlPlaneApiConfigSchema>;
