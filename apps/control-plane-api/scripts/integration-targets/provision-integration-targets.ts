import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { integrationTargets, type ControlPlaneDatabase } from "@mistle/db/control-plane";
import type { IntegrationRegistry } from "@mistle/integrations-core";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import {
  encryptIntegrationTargetSecrets,
  resolveMasterEncryptionKeyMaterial,
} from "../../src/integration-credentials/crypto.js";

export const IntegrationTargetsProvisionManifestFileName = "integration-targets.provision.json";

const IntegrationTargetProvisionTargetSchema = z
  .object({
    targetKey: z.string().min(1),
    enabled: z.boolean(),
    config: z.record(z.string(), z.unknown()),
    secrets: z.record(z.string(), z.string()).default({}),
  })
  .strict();

type IntegrationTargetsProvisionTarget = z.output<typeof IntegrationTargetProvisionTargetSchema>;

const IntegrationTargetsProvisionManifestSchema = z
  .object({
    version: z.literal(1),
    targets: z.array(IntegrationTargetProvisionTargetSchema),
  })
  .strict()
  .superRefine((input, ctx) => {
    const seenTargetKeys = new Set<string>();
    for (const [index, target] of input.targets.entries()) {
      if (seenTargetKeys.has(target.targetKey)) {
        ctx.addIssue({
          code: "custom",
          path: ["targets", index, "targetKey"],
          message: `Duplicate provision target key '${target.targetKey}'.`,
        });
      }
      seenTargetKeys.add(target.targetKey);
    }
  });

export type IntegrationTargetsProvisionManifest = z.output<
  typeof IntegrationTargetsProvisionManifestSchema
>;

type IntegrationsEncryptionConfig = {
  activeMasterEncryptionKeyVersion: number;
  masterEncryptionKeys: Record<string, string>;
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

function normalizeEscapedNewlinesInUnknownObject(value: object) {
  const normalizedValue: Record<string, unknown> = {};

  for (const [key, entryValue] of Object.entries(value)) {
    normalizedValue[key] = normalizeEscapedNewlinesInUnknownValue(entryValue);
  }

  return normalizedValue;
}

function normalizeProvisionTarget(
  target: IntegrationTargetsProvisionTarget,
): IntegrationTargetsProvisionTarget {
  const normalizedSecrets: Record<string, string> = {};

  for (const [secretKey, secretValue] of Object.entries(target.secrets)) {
    normalizedSecrets[secretKey] = normalizeEscapedNewlineString(secretValue);
  }

  return {
    ...target,
    config: normalizeEscapedNewlinesInUnknownObject(target.config),
    secrets: normalizedSecrets,
  };
}

function isRepositoryRoot(directoryPath: string): boolean {
  return existsSync(join(directoryPath, ".git"));
}

export function resolveRepositoryRootFromDirectory(startDirectory: string): string {
  let currentDirectory = resolve(startDirectory);

  while (true) {
    if (isRepositoryRoot(currentDirectory)) {
      return currentDirectory;
    }

    const parentDirectory = dirname(currentDirectory);
    if (parentDirectory === currentDirectory) {
      throw new Error(
        `Could not resolve repository root from '${resolve(startDirectory)}'. Expected a parent directory containing '.git'.`,
      );
    }

    currentDirectory = parentDirectory;
  }
}

export function discoverIntegrationTargetProvisionManifestPath(input: {
  startDirectory: string;
  repositoryRoot: string;
}): string | undefined {
  let currentDirectory = resolve(input.startDirectory);
  const repositoryRoot = resolve(input.repositoryRoot);

  while (true) {
    const candidatePath = join(currentDirectory, IntegrationTargetsProvisionManifestFileName);
    if (existsSync(candidatePath)) {
      return candidatePath;
    }

    if (currentDirectory === repositoryRoot) {
      return undefined;
    }

    const parentDirectory = dirname(currentDirectory);
    if (parentDirectory === currentDirectory) {
      return undefined;
    }

    currentDirectory = parentDirectory;
  }
}

export function parseIntegrationTargetsProvisionManifest(
  rawManifestContent: string,
): IntegrationTargetsProvisionManifest {
  let parsedManifest: unknown;
  try {
    parsedManifest = JSON.parse(rawManifestContent);
  } catch (error) {
    throw new Error("Integration target provision manifest must contain valid JSON.", {
      cause: error,
    });
  }

  const manifest = IntegrationTargetsProvisionManifestSchema.parse(parsedManifest);

  return {
    version: manifest.version,
    targets: manifest.targets.map((target) => normalizeProvisionTarget(target)),
  };
}

export async function provisionIntegrationTargets(input: {
  db: ControlPlaneDatabase;
  integrationRegistry: IntegrationRegistry;
  integrationsConfig: IntegrationsEncryptionConfig;
  manifest: IntegrationTargetsProvisionManifest;
}): Promise<Array<{ targetKey: string; enabled: boolean; secretsUpdated: boolean }>> {
  const masterEncryptionKeyMaterial = resolveMasterEncryptionKeyMaterial({
    masterKeyVersion: input.integrationsConfig.activeMasterEncryptionKeyVersion,
    masterEncryptionKeys: input.integrationsConfig.masterEncryptionKeys,
  });

  const provisionedTargets: Array<{
    targetKey: string;
    enabled: boolean;
    secretsUpdated: boolean;
  }> = [];

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
    definition.targetSecretSchema.parse(targetFromManifest.secrets);

    const encryptedTargetSecrets =
      Object.keys(targetFromManifest.secrets).length === 0
        ? null
        : encryptIntegrationTargetSecrets({
            secrets: targetFromManifest.secrets,
            masterKeyVersion: input.integrationsConfig.activeMasterEncryptionKeyVersion,
            masterEncryptionKeyMaterial,
          });

    await input.db
      .update(integrationTargets)
      .set({
        enabled: targetFromManifest.enabled,
        config: targetFromManifest.config,
        secrets: encryptedTargetSecrets,
        updatedAt: sql`now()`,
      })
      .where(eq(integrationTargets.targetKey, targetFromManifest.targetKey));

    provisionedTargets.push({
      targetKey: targetFromManifest.targetKey,
      enabled: targetFromManifest.enabled,
      secretsUpdated: encryptedTargetSecrets !== null,
    });
  }

  return provisionedTargets;
}
