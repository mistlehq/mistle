import { z } from "zod";

const SandboxProviders = ["docker"] as const;

const GlobalTelemetryEndpointSchema = z
  .url()
  .refine((value) => {
    const parsedUrl = new URL(value);
    return parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:";
  }, "telemetry endpoint must use http or https.")
  .transform((value) => value.trim());

const GlobalTelemetrySignalConfigSchema = z
  .object({
    endpoint: GlobalTelemetryEndpointSchema,
  })
  .strict();

const PartialGlobalTelemetrySignalConfigSchema = z
  .object({
    endpoint: GlobalTelemetryEndpointSchema.optional(),
  })
  .strict();

const GlobalTelemetryEnabledConfigSchema = z
  .object({
    enabled: z.literal(true),
    debug: z.boolean(),
    traces: GlobalTelemetrySignalConfigSchema,
    logs: GlobalTelemetrySignalConfigSchema,
    metrics: GlobalTelemetrySignalConfigSchema,
    resourceAttributes: z.string().trim().min(1).optional(),
  })
  .strict();

const GlobalTelemetryDisabledConfigSchema = z
  .object({
    enabled: z.literal(false),
    debug: z.boolean(),
    traces: PartialGlobalTelemetrySignalConfigSchema.optional(),
    logs: PartialGlobalTelemetrySignalConfigSchema.optional(),
    metrics: PartialGlobalTelemetrySignalConfigSchema.optional(),
    resourceAttributes: z.string().trim().min(1).optional(),
  })
  .strict();

export const GlobalTelemetryConfigSchema = z.discriminatedUnion("enabled", [
  GlobalTelemetryEnabledConfigSchema,
  GlobalTelemetryDisabledConfigSchema,
]);

export const PartialGlobalTelemetryConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    debug: z.boolean().optional(),
    traces: PartialGlobalTelemetrySignalConfigSchema.optional(),
    logs: PartialGlobalTelemetrySignalConfigSchema.optional(),
    metrics: PartialGlobalTelemetrySignalConfigSchema.optional(),
    resourceAttributes: z.string().trim().min(1).optional(),
  })
  .strict();

export const GlobalSandboxTokenConfigSchema = z
  .object({
    tokenSecret: z.string().trim().min(1),
    tokenIssuer: z.string().trim().min(1),
    tokenAudience: z.string().trim().min(1),
  })
  .strict();

export const GlobalSandboxConfigSchema = z
  .object({
    provider: z.enum(SandboxProviders),
    defaultBaseImage: z.string().trim().min(1),
    gatewayWsUrl: z.string().trim().min(1),
    internalGatewayWsUrl: z.string().trim().min(1),
    connect: GlobalSandboxTokenConfigSchema,
    bootstrap: GlobalSandboxTokenConfigSchema,
  })
  .strict();

export const PartialGlobalSandboxConfigSchema = z
  .object({
    provider: z.enum(SandboxProviders).optional(),
    defaultBaseImage: z.string().trim().min(1).optional(),
    gatewayWsUrl: z.string().trim().min(1).optional(),
    internalGatewayWsUrl: z.string().trim().min(1).optional(),
    connect: GlobalSandboxTokenConfigSchema.partial().optional(),
    bootstrap: GlobalSandboxTokenConfigSchema.partial().optional(),
  })
  .strict();

export const GlobalConfigSchema = z
  .object({
    env: z.enum(["development", "production"]),
    telemetry: GlobalTelemetryConfigSchema,
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
    telemetry: PartialGlobalTelemetryConfigSchema.optional(),
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
