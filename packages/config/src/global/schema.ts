import { z } from "zod";

export const GlobalSandboxTokenConfigSchema = z
  .object({
    tokenSecret: z.string().trim().min(1),
    tokenIssuer: z.string().trim().min(1),
    tokenAudience: z.string().trim().min(1),
  })
  .strict();

export const GlobalSandboxConfigSchema = z
  .object({
    defaultBaseImage: z.string().trim().min(1),
    gatewayWsUrl: z.string().trim().min(1),
    connect: GlobalSandboxTokenConfigSchema,
    bootstrap: GlobalSandboxTokenConfigSchema,
  })
  .strict();

export const PartialGlobalSandboxConfigSchema = z
  .object({
    defaultBaseImage: z.string().trim().min(1).optional(),
    gatewayWsUrl: z.string().trim().min(1).optional(),
    connect: GlobalSandboxTokenConfigSchema.partial().optional(),
    bootstrap: GlobalSandboxTokenConfigSchema.partial().optional(),
  })
  .strict();

export const GlobalConfigSchema = z
  .object({
    env: z.enum(["development", "production"]),
    internalAuth: z
      .object({
        serviceToken: z.string().trim().min(1),
      })
      .strict(),
    sandbox: GlobalSandboxConfigSchema,
  })
  .strict();

export const PartialGlobalConfigSchema = z
  .object({
    env: z.enum(["development", "production"]).optional(),
    internalAuth: z
      .object({
        serviceToken: z.string().trim().min(1).optional(),
      })
      .strict()
      .optional(),
    sandbox: PartialGlobalSandboxConfigSchema.optional(),
  })
  .strict();

export type GlobalConfig = z.infer<typeof GlobalConfigSchema>;
export type GlobalConfigInput = z.input<typeof GlobalConfigSchema>;
export type PartialGlobalConfigInput = z.input<typeof PartialGlobalConfigSchema>;
