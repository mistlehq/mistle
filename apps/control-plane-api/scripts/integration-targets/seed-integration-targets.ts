import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { getControlPlaneDatabaseSchema, type ControlPlaneDatabase } from "@mistle/db/control-plane";
import type { IntegrationRegistry } from "@mistle/integrations-core";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

export const IntegrationTargetsManifestFileName = "integration-targets.json";
export const IntegrationTargetsManifestJsonEnvVarName = "MISTLE_INTEGRATION_TARGETS_MANIFEST_JSON";
export const IntegrationTargetsManifestPathEnvVarName = "MISTLE_INTEGRATION_TARGETS_MANIFEST_PATH";

function resolveRepositoryRootFromDirectory(startDirectory: string): string | undefined {
  let currentDirectory = resolve(startDirectory);

  while (true) {
    if (existsSync(join(currentDirectory, ".git"))) {
      return currentDirectory;
    }

    const parentDirectory = dirname(currentDirectory);
    if (parentDirectory === currentDirectory) {
      return undefined;
    }

    currentDirectory = parentDirectory;
  }
}

const IntegrationTargetSeedSchema = z
  .object({
    targetKey: z.string().min(1),
    enabled: z.boolean(),
    config: z.record(z.string(), z.unknown()),
  })
  .strict();

type IntegrationTargetSeed = z.output<typeof IntegrationTargetSeedSchema>;

type ResolvedIntegrationTargetSeed = {
  targetKey: string;
  enabled: boolean;
  config: Record<string, unknown>;
};

const IntegrationTargetsManifestSchema = z
  .object({
    version: z.literal(1),
    targets: z.array(IntegrationTargetSeedSchema),
  })
  .strict()
  .superRefine((input, ctx) => {
    const seenTargetKeys = new Set<string>();
    for (const [index, target] of input.targets.entries()) {
      if (seenTargetKeys.has(target.targetKey)) {
        ctx.addIssue({
          code: "custom",
          path: ["targets", index, "targetKey"],
          message: `Duplicate manifest target key '${target.targetKey}'.`,
        });
      }
      seenTargetKeys.add(target.targetKey);
    }
  });

export type IntegrationTargetsManifest = z.output<typeof IntegrationTargetsManifestSchema> & {
  targets: ResolvedIntegrationTargetSeed[];
};
type IntegrationTargetsManifestEnv = Record<string, string | undefined>;

type LoadedIntegrationTargetsManifest = {
  manifest: IntegrationTargetsManifest;
  source: "env-json" | "env-path" | "discovered-path";
  sourceValue: string;
};

function normalizeEscapedNewlineString(value: string): string {
  return value
    .replaceAll("\\\\r\\\\n", "\r\n")
    .replaceAll("\\\\n", "\n")
    .replaceAll("\\r\\n", "\r\n")
    .replaceAll("\\n", "\n");
}

function normalizeEscapedNewlinesInUnknownValue(value: unknown): unknown {
  if (typeof value === "string") {
    return normalizeEscapedNewlineString(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeEscapedNewlinesInUnknownValue(item));
  }

  if (value !== null && typeof value === "object") {
    return normalizeEscapedNewlinesInUnknownObject(value);
  }

  return value;
}

function normalizeEscapedNewlinesInUnknownObject(value: object): Record<string, unknown> {
  const normalizedValue: Record<string, unknown> = {};

  for (const [key, entryValue] of Object.entries(value)) {
    normalizedValue[key] = normalizeEscapedNewlinesInUnknownValue(entryValue);
  }

  return normalizedValue;
}

function normalizeSeedTarget(target: IntegrationTargetSeed): ResolvedIntegrationTargetSeed {
  return {
    targetKey: target.targetKey,
    enabled: target.enabled,
    config: normalizeEscapedNewlinesInUnknownObject(target.config),
  };
}

export function discoverIntegrationTargetsManifestPath(input: {
  startDirectory: string;
  searchRootDirectory?: string;
}): string | undefined {
  let currentDirectory = resolve(input.startDirectory);
  const searchRootDirectory =
    input.searchRootDirectory === undefined
      ? resolveRepositoryRootFromDirectory(currentDirectory)
      : resolve(input.searchRootDirectory);

  if (searchRootDirectory === undefined) {
    return undefined;
  }

  while (true) {
    const candidatePath = join(currentDirectory, IntegrationTargetsManifestFileName);
    if (existsSync(candidatePath)) {
      return candidatePath;
    }

    if (currentDirectory === searchRootDirectory) {
      return undefined;
    }

    const parentDirectory = dirname(currentDirectory);
    if (parentDirectory === currentDirectory) {
      return undefined;
    }

    currentDirectory = parentDirectory;
  }
}

export function parseIntegrationTargetsManifest(
  rawManifestContent: string,
): IntegrationTargetsManifest {
  let parsedManifest: unknown;
  try {
    parsedManifest = JSON.parse(rawManifestContent);
  } catch (error) {
    throw new Error("Integration target manifest must contain valid JSON.", {
      cause: error,
    });
  }

  const manifest = IntegrationTargetsManifestSchema.parse(parsedManifest);

  return {
    version: manifest.version,
    targets: manifest.targets.map((target) => normalizeSeedTarget(target)),
  };
}

export function loadIntegrationTargetsManifest(input: {
  env?: IntegrationTargetsManifestEnv;
  startDirectory: string;
  searchRootDirectory?: string;
}): LoadedIntegrationTargetsManifest | undefined {
  const env = input.env ?? process.env;
  const manifestJson = env[IntegrationTargetsManifestJsonEnvVarName];
  if (manifestJson !== undefined) {
    if (manifestJson.length === 0) {
      throw new Error(
        `${IntegrationTargetsManifestJsonEnvVarName} must not be empty when provided.`,
      );
    }

    return {
      manifest: parseIntegrationTargetsManifest(manifestJson),
      source: "env-json",
      sourceValue: IntegrationTargetsManifestJsonEnvVarName,
    };
  }

  const manifestPathFromEnv = env[IntegrationTargetsManifestPathEnvVarName];
  if (manifestPathFromEnv !== undefined) {
    if (manifestPathFromEnv.length === 0) {
      throw new Error(
        `${IntegrationTargetsManifestPathEnvVarName} must not be empty when provided.`,
      );
    }

    const resolvedManifestPath = resolve(manifestPathFromEnv);
    return {
      manifest: parseIntegrationTargetsManifest(readFileSync(resolvedManifestPath, "utf8")),
      source: "env-path",
      sourceValue: resolvedManifestPath,
    };
  }

  const discoveredManifestPath = discoverIntegrationTargetsManifestPath(
    input.searchRootDirectory === undefined
      ? {
          startDirectory: input.startDirectory,
        }
      : {
          startDirectory: input.startDirectory,
          searchRootDirectory: input.searchRootDirectory,
        },
  );
  if (discoveredManifestPath === undefined) {
    return undefined;
  }

  return {
    manifest: parseIntegrationTargetsManifest(readFileSync(discoveredManifestPath, "utf8")),
    source: "discovered-path",
    sourceValue: discoveredManifestPath,
  };
}

export async function seedIntegrationTargets(input: {
  db: ControlPlaneDatabase;
  integrationRegistry: IntegrationRegistry;
  manifest: IntegrationTargetsManifest;
}): Promise<Array<{ targetKey: string; enabled: boolean }>> {
  const seededTargets: Array<{ targetKey: string; enabled: boolean }> = [];
  const tables = getControlPlaneDatabaseSchema(input.db);

  for (const targetFromManifest of input.manifest.targets) {
    const existingTarget = await input.db.query.integrationTargets.findFirst({
      where: (table, { eq }) => eq(table.targetKey, targetFromManifest.targetKey),
    });
    if (existingTarget === undefined) {
      throw new Error(
        `Integration target '${targetFromManifest.targetKey}' was not found. Run integration target sync before provisioning.`,
      );
    }

    const definition = input.integrationRegistry.getDefinition({
      familyId: existingTarget.familyId,
      variantId: existingTarget.variantId,
    });
    if (definition === undefined) {
      throw new Error(
        `Integration definition '${existingTarget.familyId}::${existingTarget.variantId}' for target '${targetFromManifest.targetKey}' was not found.`,
      );
    }

    definition.targetConfigSchema.parse(targetFromManifest.config);
    const parsedDeprecatedTargetSecrets = definition.targetSecretSchema.safeParse({});
    if (!parsedDeprecatedTargetSecrets.success) {
      throw new Error(
        `Integration target '${targetFromManifest.targetKey}' requires target secrets, but tracked manifest seeding no longer supports target secrets.`,
      );
    }

    await input.db
      .update(tables.integrationTargets)
      .set({
        enabled: targetFromManifest.enabled,
        config: targetFromManifest.config,
        secrets: null,
        updatedAt: sql`now()`,
      })
      .where(eq(tables.integrationTargets.targetKey, targetFromManifest.targetKey));

    seededTargets.push({
      targetKey: targetFromManifest.targetKey,
      enabled: targetFromManifest.enabled,
    });
  }

  return seededTargets;
}
