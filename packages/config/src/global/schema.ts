import { z } from "zod";

const SandboxProviders = ["docker", "e2b"] as const;

export const SandboxStorageBackend = {
  ARCHIL: "archil",
  DOCKER_VOLUME: "docker_volume",
} as const;

export type SandboxStorageBackend =
  (typeof SandboxStorageBackend)[keyof typeof SandboxStorageBackend];

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

export const GlobalSandboxPublishSessionConfigSchema = z
  .object({
    cookieSigningSecret: z.string().trim().min(1),
  })
  .strict();

export const PartialGlobalSandboxPublishSessionConfigSchema = z
  .object({
    cookieSigningSecret: z.string().trim().min(1).optional(),
  })
  .strict();

export const GlobalSandboxPublishConfigSchema = z
  .object({
    baseDomain: z.string().trim().min(1),
    access: GlobalSandboxTokenConfigSchema,
    session: GlobalSandboxPublishSessionConfigSchema,
  })
  .strict();
// Reserved for browser publishing phases. Phase 1 process inventory does not
// consume this config yet, but keeping the shape stable avoids speculative
// churn before the browser-publishing auth/bootstrap path lands.

export const PartialGlobalSandboxPublishConfigSchema = z
  .object({
    baseDomain: z.string().trim().min(1).optional(),
    access: GlobalSandboxTokenConfigSchema.partial().optional(),
    session: PartialGlobalSandboxPublishSessionConfigSchema.optional(),
  })
  .strict();

export const GlobalSandboxStorageConfigSchema = z
  .object({
    backend: z.enum([SandboxStorageBackend.ARCHIL, SandboxStorageBackend.DOCKER_VOLUME]).optional(),
  })
  .strict();

export const PartialGlobalSandboxStorageConfigSchema = z
  .object({
    backend: z.enum([SandboxStorageBackend.ARCHIL, SandboxStorageBackend.DOCKER_VOLUME]).optional(),
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
    egress: GlobalSandboxTokenConfigSchema,
    publish: GlobalSandboxPublishConfigSchema,
    storage: GlobalSandboxStorageConfigSchema.optional(),
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
    egress: GlobalSandboxTokenConfigSchema.partial().optional(),
    publish: PartialGlobalSandboxPublishConfigSchema.optional(),
    storage: PartialGlobalSandboxStorageConfigSchema.optional(),
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
export type GlobalSandboxConfig = z.infer<typeof GlobalSandboxConfigSchema>;
export type GlobalTelemetryConfig = z.infer<typeof GlobalTelemetryConfigSchema>;
export type GlobalConfigInput = z.input<typeof GlobalConfigSchema>;
export type PartialGlobalConfigInput = z.input<typeof PartialGlobalConfigSchema>;
