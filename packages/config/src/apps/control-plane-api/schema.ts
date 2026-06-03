import { z } from "zod";

import {
  GlobalSandboxTokenConfigSchema,
  GlobalTelemetryConfigSchema,
} from "../../global/schema.js";

const DefaultE2BCloudDomain = "e2b.app";

const ValkeyUrlSchema = z.url().refine((value) => {
  const parsedUrl = new URL(value);
  return parsedUrl.protocol === "redis:" || parsedUrl.protocol === "rediss:";
}, "Expected a redis or rediss URL.");

export const ControlPlaneApiCacheValkeyConfigSchema = z
  .object({
    url: ValkeyUrlSchema,
    keyPrefix: z.string().min(1),
  })
  .strict();

export const PartialControlPlaneApiCacheValkeyConfigSchema =
  ControlPlaneApiCacheValkeyConfigSchema.partial();

export const ControlPlaneApiCacheConfigSchema = z
  .object({
    backend: z.enum(["memory", "valkey"]),
    valkey: ControlPlaneApiCacheValkeyConfigSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.backend === "memory" && value.valkey !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["valkey"],
        message: "cache.valkey must be omitted when cache.backend is 'memory'.",
      });
    }

    if (value.backend === "valkey" && value.valkey === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["valkey"],
        message: "cache.valkey is required when cache.backend is 'valkey'.",
      });
    }
  });

export const PartialControlPlaneApiCacheConfigSchema = z
  .object({
    backend: z.enum(["memory", "valkey"]).optional(),
    valkey: PartialControlPlaneApiCacheValkeyConfigSchema.optional(),
  })
  .strict();

const ControlPlaneApiSandboxDockerConfigSchema = z
  .object({
    enabled: z.boolean(),
  })
  .strict();

const ControlPlaneApiSandboxE2BConfigSchema = z.discriminatedUnion("enabled", [
  z
    .object({
      enabled: z.literal(true),
      apiKey: z.string().min(1),
      domain: z.string().min(1).default(DefaultE2BCloudDomain),
    })
    .strict(),
  z
    .object({
      enabled: z.literal(false),
      apiKey: z.string().min(1).optional(),
      domain: z.string().min(1).optional(),
    })
    .strict(),
]);

const ControlPlaneApiSandboxTensorlakeConfigSchema = z.discriminatedUnion("enabled", [
  z
    .object({
      enabled: z.literal(true),
      apiKey: z.string().min(1),
    })
    .strict(),
  z
    .object({
      enabled: z.literal(false),
      apiKey: z.string().min(1).optional(),
    })
    .strict(),
]);

const ControlPlaneApiAuthGoogleConfigSchema = z
  .object({
    clientId: z.string().min(1),
    clientSecret: z.string().min(1),
  })
  .strict();

const ControlPlaneApiWelcomeEmailConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    callUrl: z.url().optional(),
  })
  .strict()
  .default({ enabled: false });

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
    allowSignups: z.boolean().default(true),
    welcomeEmail: ControlPlaneApiWelcomeEmailConfigSchema,
    otpLength: z.number().int().min(4).max(12),
    otpExpiresInSeconds: z.number().int().min(30),
    otpAllowedAttempts: z.number().int().min(1).max(10),
    google: ControlPlaneApiAuthGoogleConfigSchema.optional(),
  })
  .strict();

export const ControlPlaneApiMcpAuthConfigSchema = z
  .object({
    secret: z.string().trim().min(1),
    issuer: z.string().trim().min(1),
    audience: z.string().trim().min(1),
  })
  .strict();

export const ControlPlaneApiMcpConfigSchema = z
  .object({
    url: z.string().trim().min(1),
    trustForwardedHeaders: z.boolean().default(false),
    auth: ControlPlaneApiMcpAuthConfigSchema,
  })
  .strict();

export const ControlPlaneApiDashboardConfigSchema = z
  .object({
    baseUrl: z.string().min(1),
  })
  .strict();

const ControlPlaneApiBillingConfigObjectSchema = z
  .object({
    stripe: z
      .object({
        enabled: z.boolean(),
      })
      .strict(),
  })
  .strict();

export const ControlPlaneApiBillingConfigSchema = ControlPlaneApiBillingConfigObjectSchema.default({
  stripe: { enabled: false },
});

const ControlPlaneApiWorkflowConfigObjectSchema = z
  .object({
    databaseUrl: z.string().min(1),
    databasePoolMax: z.number().int().min(1),
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

export const ControlPlaneApiPtyConfigSchema = GlobalSandboxTokenConfigSchema;

export const ControlPlaneApiSandboxRuntimeConfigSchema = z
  .object({
    defaultBaseImage: z.string().trim().min(1),
    gatewayWsUrl: z.string().trim().min(1),
    bootstrap: GlobalSandboxTokenConfigSchema.optional(),
    docker: ControlPlaneApiSandboxDockerConfigSchema.optional(),
    e2b: ControlPlaneApiSandboxE2BConfigSchema.optional(),
    tensorlake: ControlPlaneApiSandboxTensorlakeConfigSchema.optional(),
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
    cache: ControlPlaneApiCacheConfigSchema.default({ backend: "memory" }),
    objectStore: ControlPlaneApiObjectStoreConfigSchema,
    auth: ControlPlaneApiAuthConfigSchema,
    mcp: ControlPlaneApiMcpConfigSchema,
    dashboard: ControlPlaneApiDashboardConfigSchema,
    billing: ControlPlaneApiBillingConfigSchema,
    workflow: ControlPlaneApiWorkflowConfigSchema,
    dataPlaneApi: ControlPlaneApiDataPlaneApiConfigSchema,
    internalAuth: ControlPlaneApiInternalAuthConfigSchema,
    connectionToken: ControlPlaneApiConnectionTokenConfigSchema,
    portAccess: ControlPlaneApiPortAccessConfigSchema,
    ptyTransport: ControlPlaneApiPtyConfigSchema,
    sandbox: ControlPlaneApiSandboxRuntimeConfigSchema,
    commitSign: ControlPlaneApiCommitSignConfigSchema.optional(),
    integrations: ControlPlaneApiIntegrationsConfigSchema,
  })
  .strict();

export const ControlPlaneApiMaintenanceConfigSchema = z
  .object({
    database: z
      .object({
        controlPlaneMigrationUrl: z.string().min(1).optional(),
        dataPlaneMigrationUrl: z.string().min(1).optional(),
      })
      .strict(),
    telemetry: GlobalTelemetryConfigSchema,
  })
  .strict();

export const PartialControlPlaneApiConfigSchema = z
  .object({
    server: ControlPlaneApiServerConfigSchema.partial().optional(),
    database: ControlPlaneApiDatabaseConfigSchema.partial().optional(),
    cache: PartialControlPlaneApiCacheConfigSchema.optional(),
    objectStore: ControlPlaneApiObjectStoreConfigSchema.partial().optional(),
    auth: ControlPlaneApiAuthConfigSchema.partial().optional(),
    mcp: ControlPlaneApiMcpConfigSchema.partial()
      .extend({ auth: ControlPlaneApiMcpAuthConfigSchema.partial().optional() })
      .strict()
      .optional(),
    dashboard: ControlPlaneApiDashboardConfigSchema.partial().optional(),
    billing: ControlPlaneApiBillingConfigObjectSchema.partial().optional(),
    workflow: ControlPlaneApiWorkflowConfigObjectSchema.partial().optional(),
    dataPlaneApi: ControlPlaneApiDataPlaneApiConfigSchema.partial().optional(),
    internalAuth: ControlPlaneApiInternalAuthConfigSchema.partial().optional(),
    connectionToken: ControlPlaneApiConnectionTokenConfigSchema.partial().optional(),
    portAccess: ControlPlaneApiPortAccessConfigSchema.partial().optional(),
    ptyTransport: ControlPlaneApiPtyConfigSchema.partial().optional(),
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
