import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parse as parseToml } from "smol-toml";
import { z } from "zod";

type UnknownRecord = Record<string, unknown>;
type PartialIntegrationTargetsSyncConfig = {
  databaseUrl?: string;
  integrations?: {
    activeMasterEncryptionKeyVersion?: number;
    masterEncryptionKeys?: Record<string, string>;
  };
};

const IntegrationTargetsSyncConfigSchema = z
  .object({
    databaseUrl: z.string().min(1),
    integrations: z
      .object({
        activeMasterEncryptionKeyVersion: z.number().int().min(1),
        masterEncryptionKeys: z.record(z.string().regex(/^[1-9]\d*$/), z.string().min(1)),
      })
      .strict()
      .refine((config) => Object.keys(config.masterEncryptionKeys).length > 0, {
        message: "At least one master encryption key must be configured.",
        path: ["masterEncryptionKeys"],
      })
      .refine(
        (config) =>
          Object.prototype.hasOwnProperty.call(
            config.masterEncryptionKeys,
            String(config.activeMasterEncryptionKeyVersion),
          ),
        {
          message: "Active master encryption key version must exist in masterEncryptionKeys.",
          path: ["activeMasterEncryptionKeyVersion"],
        },
      ),
  })
  .strict();

type IntegrationTargetsSyncConfig = z.output<typeof IntegrationTargetsSyncConfigSchema>;

function resolveWorkspaceRoot(scriptDirectory: string): string {
  return resolve(scriptDirectory, "../../..");
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asObjectRecord(value: unknown): UnknownRecord {
  if (!isRecord(value)) {
    return {};
  }

  return value;
}

function loadTomlConfig(configPath: string): PartialIntegrationTargetsSyncConfig {
  const parsedRoot = asObjectRecord(parseToml(readFileSync(configPath, "utf8")));
  const apps = asObjectRecord(parsedRoot.apps);
  const controlPlaneApi = asObjectRecord(apps.control_plane_api);
  const database = asObjectRecord(controlPlaneApi.database);
  const integrations = asObjectRecord(controlPlaneApi.integrations);
  const masterEncryptionKeys = asObjectRecord(integrations.master_encryption_keys);
  const activeMasterEncryptionKeyVersion =
    typeof integrations.active_master_encryption_key_version === "number"
      ? integrations.active_master_encryption_key_version
      : undefined;

  const normalizedMasterEncryptionKeys: Record<string, string> = {};
  for (const [version, keyMaterial] of Object.entries(masterEncryptionKeys)) {
    if (typeof keyMaterial === "string") {
      normalizedMasterEncryptionKeys[version] = keyMaterial;
    }
  }

  return {
    ...(typeof database.url === "string" ? { databaseUrl: database.url } : {}),
    ...(Object.keys(normalizedMasterEncryptionKeys).length === 0 &&
    activeMasterEncryptionKeyVersion === undefined
      ? {}
      : {
          integrations: {
            ...(activeMasterEncryptionKeyVersion === undefined
              ? {}
              : { activeMasterEncryptionKeyVersion }),
            masterEncryptionKeys: normalizedMasterEncryptionKeys,
          },
        }),
  };
}

function loadEnvConfig(environment: NodeJS.ProcessEnv): PartialIntegrationTargetsSyncConfig {
  const normalizedEnvConfig: PartialIntegrationTargetsSyncConfig = {};

  const databaseUrl = environment.MISTLE_APPS_CONTROL_PLANE_API_DATABASE_URL;
  if (typeof databaseUrl === "string" && databaseUrl.length > 0) {
    normalizedEnvConfig.databaseUrl = databaseUrl;
  }

  const activeMasterEncryptionKeyVersion =
    environment.MISTLE_APPS_CONTROL_PLANE_API_INTEGRATIONS_ACTIVE_MASTER_ENCRYPTION_KEY_VERSION;
  const masterEncryptionKeysJson =
    environment.MISTLE_APPS_CONTROL_PLANE_API_INTEGRATIONS_MASTER_ENCRYPTION_KEYS_JSON;

  if (
    typeof activeMasterEncryptionKeyVersion === "string" &&
    activeMasterEncryptionKeyVersion.length > 0 &&
    typeof masterEncryptionKeysJson === "string" &&
    masterEncryptionKeysJson.length > 0
  ) {
    let parsedMasterEncryptionKeys: unknown;
    try {
      parsedMasterEncryptionKeys = JSON.parse(masterEncryptionKeysJson);
    } catch (error) {
      throw new Error(
        `Invalid MISTLE_APPS_CONTROL_PLANE_API_INTEGRATIONS_MASTER_ENCRYPTION_KEYS_JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const normalizedMasterEncryptionKeys: Record<string, string> = {};
    for (const [version, keyMaterial] of Object.entries(
      asObjectRecord(parsedMasterEncryptionKeys),
    )) {
      if (typeof keyMaterial !== "string") {
        throw new Error(
          `Invalid integrations master encryption key value for version '${version}'. Expected a string.`,
        );
      }

      normalizedMasterEncryptionKeys[version] = keyMaterial;
    }

    normalizedEnvConfig.integrations = {
      activeMasterEncryptionKeyVersion: Number(activeMasterEncryptionKeyVersion),
      masterEncryptionKeys: normalizedMasterEncryptionKeys,
    };
  }

  return normalizedEnvConfig;
}

export function resolveIntegrationTargetsSyncConfigPath(
  environment: NodeJS.ProcessEnv,
  scriptDirectory: string,
): string | undefined {
  const explicitConfigPath = environment.MISTLE_CONFIG_PATH;
  if (typeof explicitConfigPath === "string" && explicitConfigPath.trim().length > 0) {
    return explicitConfigPath;
  }

  const workspaceRoot = resolveWorkspaceRoot(scriptDirectory);
  const developmentConfigPath = resolve(workspaceRoot, "config", "config.development.toml");
  if (existsSync(developmentConfigPath)) {
    return developmentConfigPath;
  }

  const productionConfigPath = resolve(workspaceRoot, "config", "config.production.toml");
  if (existsSync(productionConfigPath)) {
    return productionConfigPath;
  }

  return undefined;
}

export function loadIntegrationTargetsSyncConfig(input: {
  environment: NodeJS.ProcessEnv;
  scriptDirectory: string;
}): IntegrationTargetsSyncConfig {
  const configPath = resolveIntegrationTargetsSyncConfigPath(
    input.environment,
    input.scriptDirectory,
  );
  const tomlConfig = configPath === undefined ? {} : loadTomlConfig(configPath);
  const envConfig = loadEnvConfig(input.environment);

  return IntegrationTargetsSyncConfigSchema.parse({
    ...tomlConfig,
    ...envConfig,
    ...(tomlConfig.integrations === undefined && envConfig.integrations === undefined
      ? {}
      : {
          integrations: {
            ...tomlConfig.integrations,
            ...envConfig.integrations,
          },
        }),
  });
}

export function loadIntegrationTargetsSyncConfigFromModuleUrl(input: {
  environment: NodeJS.ProcessEnv;
  moduleUrl: string;
}): IntegrationTargetsSyncConfig {
  return loadIntegrationTargetsSyncConfig({
    environment: input.environment,
    scriptDirectory: dirname(fileURLToPath(input.moduleUrl)),
  });
}
