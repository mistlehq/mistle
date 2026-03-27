import { z } from "zod";

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

export const DataPlaneApiWorkflowConfigSchema = z
  .object({
    databaseUrl: z.string().min(1),
    namespaceId: z.string().min(1),
  })
  .strict();

export const DataPlaneApiRuntimeStateConfigSchema = z
  .object({
    gatewayBaseUrl: HttpBaseUrlSchema,
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
    docker: DataPlaneApiSandboxDockerConfigSchema.optional(),
    e2b: DataPlaneApiSandboxE2BConfigSchema.optional(),
  })
  .strict();

export const PartialDataPlaneApiSandboxConfigSchema = z
  .object({
    docker: DataPlaneApiSandboxDockerConfigSchema.partial().optional(),
    e2b: DataPlaneApiSandboxE2BConfigSchema.partial().optional(),
  })
  .strict();

export const DataPlaneApiConfigSchema = z
  .object({
    server: DataPlaneApiServerConfigSchema,
    database: DataPlaneApiDatabaseConfigSchema,
    workflow: DataPlaneApiWorkflowConfigSchema,
    runtimeState: DataPlaneApiRuntimeStateConfigSchema,
    sandbox: DataPlaneApiSandboxConfigSchema,
  })
  .strict();

export const PartialDataPlaneApiConfigSchema = z
  .object({
    server: DataPlaneApiServerConfigSchema.partial().optional(),
    database: DataPlaneApiDatabaseConfigSchema.partial().optional(),
    workflow: DataPlaneApiWorkflowConfigSchema.partial().optional(),
    runtimeState: DataPlaneApiRuntimeStateConfigSchema.partial().optional(),
    sandbox: PartialDataPlaneApiSandboxConfigSchema.optional(),
  })
  .strict();

const DataPlaneApiProviderRequirementMessages = {
  DOCKER:
    "apps.data_plane_api.sandbox.docker is required when global.sandbox.provider is 'docker'.",
  E2B: "apps.data_plane_api.sandbox.e2b is required when global.sandbox.provider is 'e2b'.",
} as const;

export function getDataPlaneApiSandboxProviderValidationIssue(input: {
  globalSandboxProvider: (typeof SandboxProviders)[number];
  appSandbox: DataPlaneApiConfig["sandbox"];
}): {
  path: readonly ["sandbox", "docker"] | readonly ["sandbox", "e2b"];
  message: string;
} | null {
  if (input.globalSandboxProvider === "docker" && input.appSandbox.docker === undefined) {
    return {
      path: ["sandbox", "docker"],
      message: DataPlaneApiProviderRequirementMessages.DOCKER,
    };
  }

  if (input.globalSandboxProvider === "e2b" && input.appSandbox.e2b === undefined) {
    return {
      path: ["sandbox", "e2b"],
      message: DataPlaneApiProviderRequirementMessages.E2B,
    };
  }

  return null;
}

export type DataPlaneApiConfig = z.infer<typeof DataPlaneApiConfigSchema>;
export type PartialDataPlaneApiConfigInput = z.input<typeof PartialDataPlaneApiConfigSchema>;
