import { z } from "zod";

import { GlobalSandboxStorageConfigSchema } from "../../global/schema.js";

const SandboxProviders = ["docker", "e2b"] as const;
const DefaultE2BCloudDomain = "e2b.app";

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

export const DataPlaneApiSandboxDockerConfigSchema = z
  .object({
    socketPath: z.string().min(1),
  })
  .strict();

export const DataPlaneApiSandboxE2BConfigSchema = z
  .object({
    apiKey: z.string().min(1),
    domain: z.string().min(1).default(DefaultE2BCloudDomain),
  })
  .strict();

export const DataPlaneApiSandboxConfigSchema = z
  .object({
    provider: z.enum(SandboxProviders),
    storage: GlobalSandboxStorageConfigSchema.optional(),
    docker: DataPlaneApiSandboxDockerConfigSchema.optional(),
    e2b: DataPlaneApiSandboxE2BConfigSchema.optional(),
  })
  .strict();

export const PartialDataPlaneApiSandboxConfigSchema = z
  .object({
    provider: z.enum(SandboxProviders).optional(),
    storage: GlobalSandboxStorageConfigSchema.partial().optional(),
    docker: DataPlaneApiSandboxDockerConfigSchema.partial().optional(),
    e2b: DataPlaneApiSandboxE2BConfigSchema.partial().optional(),
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

const DataPlaneApiProviderRequirementMessages = {
  DOCKER: "sandbox.docker is required when sandbox.provider is 'docker'.",
  E2B: "sandbox.e2b is required when sandbox.provider is 'e2b'.",
} as const;

export function getDataPlaneApiSandboxProviderValidationIssue(input: {
  appSandbox: DataPlaneApiConfig["sandbox"];
}): {
  path: readonly ["sandbox", "docker"] | readonly ["sandbox", "e2b"];
  message: string;
} | null {
  if (input.appSandbox.provider === "docker" && input.appSandbox.docker === undefined) {
    return {
      path: ["sandbox", "docker"],
      message: DataPlaneApiProviderRequirementMessages.DOCKER,
    };
  }

  if (input.appSandbox.provider === "e2b" && input.appSandbox.e2b === undefined) {
    return {
      path: ["sandbox", "e2b"],
      message: DataPlaneApiProviderRequirementMessages.E2B,
    };
  }

  return null;
}

export type DataPlaneApiConfig = z.infer<typeof DataPlaneApiConfigSchema>;
export type PartialDataPlaneApiConfigInput = z.input<typeof PartialDataPlaneApiConfigSchema>;
