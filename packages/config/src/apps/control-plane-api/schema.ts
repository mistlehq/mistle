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

export const ControlPlaneApiEmailConfigSchema = z
  .object({
    fromAddress: z.string().min(1),
    fromName: z.string().min(1),
    smtpHost: z.string().min(1),
    smtpPort: z.number().int().min(1).max(65535),
    smtpSecure: z.boolean(),
    smtpUsername: z.string().min(1),
    smtpPassword: z.string().min(1),
  })
  .strict();

export const ControlPlaneApiWorkflowConfigSchema = z
  .object({
    databaseUrl: z.string().min(1),
    namespaceId: z.string().min(1),
  })
  .strict();

export const ControlPlaneApiConfigSchema = z
  .object({
    server: ControlPlaneApiServerConfigSchema,
    database: ControlPlaneApiDatabaseConfigSchema,
    auth: ControlPlaneApiAuthConfigSchema,
    email: ControlPlaneApiEmailConfigSchema,
    workflow: ControlPlaneApiWorkflowConfigSchema,
  })
  .strict();

export const PartialControlPlaneApiConfigSchema = z
  .object({
    server: ControlPlaneApiServerConfigSchema.partial().optional(),
    database: ControlPlaneApiDatabaseConfigSchema.partial().optional(),
    auth: ControlPlaneApiAuthConfigSchema.partial().optional(),
    email: ControlPlaneApiEmailConfigSchema.partial().optional(),
    workflow: ControlPlaneApiWorkflowConfigSchema.partial().optional(),
  })
  .strict();

export type ControlPlaneApiConfig = z.infer<typeof ControlPlaneApiConfigSchema>;
export type PartialControlPlaneApiConfigInput = z.input<typeof PartialControlPlaneApiConfigSchema>;
