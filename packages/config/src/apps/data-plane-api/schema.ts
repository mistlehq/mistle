import { z } from "zod";

const DefaultE2BCloudDomain = "e2b.app";
const ModalSandboxMaxTimeoutMs = 24 * 60 * 60 * 1000;

const HttpBaseUrlSchema = z.url().refine((value) => {
  const parsedUrl = new URL(value);
  return parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:";
}, "Expected an http or https URL.");

export const DataPlaneApiServerConfigSchema = z
  .object({
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
  })
  .strict();

export const DataPlaneApiDatabaseConfigSchema = z
  .object({
    url: z.string().min(1),
    migrationUrl: z.string().min(1),
  })
  .strict();

const DataPlaneApiWorkflowConfigObjectSchema = z
  .object({
    databaseUrl: z.string().min(1),
    databasePoolMax: z.number().int().min(1),
    migrationUrl: z.string().min(1).optional(),
    namespaceId: z.string().min(1),
  })
  .strict();

export const DataPlaneApiWorkflowConfigSchema = DataPlaneApiWorkflowConfigObjectSchema.transform(
  (workflow) => ({
    ...workflow,
    // Legacy TOML/env only has databaseUrl. Keep that shape working until
    // managed deployments use deployment-owned workflow migration jobs.
    migrationUrl: workflow.migrationUrl ?? workflow.databaseUrl,
  }),
);

export const DataPlaneApiRuntimeStateConfigSchema = z
  .object({
    gatewayBaseUrl: HttpBaseUrlSchema,
  })
  .strict();

export const DataPlaneApiControlPlaneApiConfigSchema = z
  .object({
    baseUrl: HttpBaseUrlSchema,
  })
  .strict();

export const PartialDataPlaneApiControlPlaneApiConfigSchema = z
  .object({
    baseUrl: HttpBaseUrlSchema.optional(),
  })
  .strict();

export const DataPlaneApiSandboxDockerConfigSchema = z.discriminatedUnion("enabled", [
  z
    .object({
      enabled: z.literal(true),
      socketPath: z.string().min(1),
    })
    .strict(),
  z
    .object({
      enabled: z.literal(false),
      socketPath: z.string().min(1).optional(),
    })
    .strict(),
]);

const PartialDataPlaneApiSandboxDockerConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    socketPath: z.string().min(1).optional(),
  })
  .strict();

export const DataPlaneApiSandboxE2BConfigSchema = z.discriminatedUnion("enabled", [
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

const PartialDataPlaneApiSandboxE2BConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    apiKey: z.string().min(1).optional(),
    domain: z.string().min(1).optional(),
  })
  .strict();

export const DataPlaneApiSandboxTensorlakeConfigSchema = z.discriminatedUnion("enabled", [
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

const PartialDataPlaneApiSandboxTensorlakeConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    apiKey: z.string().min(1).optional(),
  })
  .strict();

export const DataPlaneApiSandboxOpenComputerConfigSchema = z.discriminatedUnion("enabled", [
  z
    .object({
      enabled: z.literal(true),
      apiKey: z.string().min(1),
      apiBaseUrl: z.url().optional(),
    })
    .strict(),
  z
    .object({
      enabled: z.literal(false),
      apiKey: z.string().min(1).optional(),
      apiBaseUrl: z.url().optional(),
    })
    .strict(),
]);

const PartialDataPlaneApiSandboxOpenComputerConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    apiKey: z.string().min(1).optional(),
    apiBaseUrl: z.url().optional(),
  })
  .strict();

export const DataPlaneApiSandboxFreestyleConfigSchema = z.discriminatedUnion("enabled", [
  z
    .object({
      enabled: z.literal(true),
      apiKey: z.string().min(1),
      baseUrl: z.url().optional(),
    })
    .strict(),
  z
    .object({
      enabled: z.literal(false),
      apiKey: z.string().min(1).optional(),
      baseUrl: z.url().optional(),
    })
    .strict(),
]);

const PartialDataPlaneApiSandboxFreestyleConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    apiKey: z.string().min(1).optional(),
    baseUrl: z.url().optional(),
  })
  .strict();

export const DataPlaneApiSandboxModalConfigSchema = z.discriminatedUnion("enabled", [
  z
    .object({
      enabled: z.literal(true),
      tokenId: z.string().min(1),
      tokenSecret: z.string().min(1),
      appName: z.string().min(1),
      environment: z.string().min(1).optional(),
      defaultTimeoutMs: z.number().int().min(1).max(ModalSandboxMaxTimeoutMs).optional(),
    })
    .strict(),
  z
    .object({
      enabled: z.literal(false),
      tokenId: z.string().min(1).optional(),
      tokenSecret: z.string().min(1).optional(),
      appName: z.string().min(1).optional(),
      environment: z.string().min(1).optional(),
      defaultTimeoutMs: z.number().int().min(1).max(ModalSandboxMaxTimeoutMs).optional(),
    })
    .strict(),
]);

const PartialDataPlaneApiSandboxModalConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    tokenId: z.string().min(1).optional(),
    tokenSecret: z.string().min(1).optional(),
    appName: z.string().min(1).optional(),
    environment: z.string().min(1).optional(),
    defaultTimeoutMs: z.number().int().min(1).max(ModalSandboxMaxTimeoutMs).optional(),
  })
  .strict();

export const DataPlaneApiSandboxConfigSchema = z
  .object({
    docker: DataPlaneApiSandboxDockerConfigSchema.optional(),
    e2b: DataPlaneApiSandboxE2BConfigSchema.optional(),
    freestyle: DataPlaneApiSandboxFreestyleConfigSchema.optional(),
    modal: DataPlaneApiSandboxModalConfigSchema.optional(),
    opencomputer: DataPlaneApiSandboxOpenComputerConfigSchema.optional(),
    tensorlake: DataPlaneApiSandboxTensorlakeConfigSchema.optional(),
  })
  .strict();

export const PartialDataPlaneApiSandboxConfigSchema = z
  .object({
    docker: PartialDataPlaneApiSandboxDockerConfigSchema.optional(),
    e2b: PartialDataPlaneApiSandboxE2BConfigSchema.optional(),
    freestyle: PartialDataPlaneApiSandboxFreestyleConfigSchema.optional(),
    modal: PartialDataPlaneApiSandboxModalConfigSchema.optional(),
    opencomputer: PartialDataPlaneApiSandboxOpenComputerConfigSchema.optional(),
    tensorlake: PartialDataPlaneApiSandboxTensorlakeConfigSchema.optional(),
  })
  .strict();

export const DataPlaneApiInternalAuthConfigSchema = z
  .object({
    serviceToken: z.string().trim().min(1),
  })
  .strict();

export const DataPlaneApiConfigSchema = z
  .object({
    server: DataPlaneApiServerConfigSchema,
    database: DataPlaneApiDatabaseConfigSchema,
    workflow: DataPlaneApiWorkflowConfigSchema,
    runtimeState: DataPlaneApiRuntimeStateConfigSchema,
    sandbox: DataPlaneApiSandboxConfigSchema,
    controlPlaneApi: DataPlaneApiControlPlaneApiConfigSchema,
    internalAuth: DataPlaneApiInternalAuthConfigSchema,
  })
  .strict();

export const PartialDataPlaneApiConfigSchema = z
  .object({
    server: DataPlaneApiServerConfigSchema.partial().optional(),
    database: DataPlaneApiDatabaseConfigSchema.partial().optional(),
    workflow: DataPlaneApiWorkflowConfigObjectSchema.partial().optional(),
    runtimeState: DataPlaneApiRuntimeStateConfigSchema.partial().optional(),
    sandbox: PartialDataPlaneApiSandboxConfigSchema.optional(),
    controlPlaneApi: PartialDataPlaneApiControlPlaneApiConfigSchema.optional(),
    internalAuth: DataPlaneApiInternalAuthConfigSchema.partial().optional(),
  })
  .strict();

export function getDataPlaneApiSandboxProviderValidationIssue(input: {
  appSandbox: Pick<
    DataPlaneApiConfig["sandbox"],
    "docker" | "e2b" | "freestyle" | "modal" | "opencomputer" | "tensorlake"
  >;
}): {
  path: readonly ["sandbox", "docker"];
  message: string;
} | null {
  void input;
  return null;
}

export type DataPlaneApiConfig = z.infer<typeof DataPlaneApiConfigSchema>;
export type PartialDataPlaneApiConfigInput = z.input<typeof PartialDataPlaneApiConfigSchema>;
