import type { IntegrationTarget } from "@mistle/db/control-plane";
import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import { BadRequestError, NotFoundError } from "@mistle/http/errors.js";
import {
  IntegrationConnectionMethodIds,
  type IntegrationRegistry,
  type IntegrationRedirectHandler,
} from "@mistle/integrations-core";
import { z } from "zod";

import { resolveIntegrationTargetSecrets } from "../../lib/integration-target-secrets.js";
import {
  IntegrationConnectionsBadRequestCodes,
  IntegrationConnectionsNotFoundCodes,
} from "../constants.js";

function toUnknownRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const record: Record<string, unknown> = {};
  for (const [key, entryValue] of Object.entries(value)) {
    record[key] = entryValue;
  }

  return record;
}

function toStringRecord(value: unknown): Record<string, string> | null {
  const record = toUnknownRecord(value);
  if (record === null) {
    return null;
  }

  const stringRecord: Record<string, string> = {};
  for (const [key, entryValue] of Object.entries(record)) {
    if (typeof entryValue !== "string") {
      return null;
    }
    stringRecord[key] = entryValue;
  }

  return stringRecord;
}

export type ResolvedGitHubAppInstallationHandlerTarget = {
  target: {
    targetKey: string;
    familyId: string;
    variantId: string;
    enabled: true;
    config: Record<string, unknown>;
    secrets: Record<string, string>;
  };
  redirectHandler: IntegrationRedirectHandler<Record<string, unknown>, Record<string, string>>;
};

async function resolveEnabledTargetOrThrow(
  db: ControlPlaneDatabase,
  targetKey: string,
): Promise<IntegrationTarget> {
  const target = await db.query.integrationTargets.findFirst({
    where: (table, { and, eq }) => and(eq(table.targetKey, targetKey), eq(table.enabled, true)),
  });

  if (target === undefined) {
    throw new NotFoundError(
      IntegrationConnectionsNotFoundCodes.TARGET_NOT_FOUND,
      `Integration target '${targetKey}' was not found.`,
    );
  }

  return target;
}

export async function resolveGitHubAppInstallationHandlerTargetOrThrow(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
    integrationsConfig: {
      activeMasterEncryptionKeyVersion: number;
      masterEncryptionKeys: Record<string, string>;
    };
  },
  input: {
    targetKey: string;
    invalidInputCode:
      | "INVALID_GITHUB_APP_INSTALLATION_START_INPUT"
      | "INVALID_GITHUB_APP_INSTALLATION_COMPLETE_INPUT";
  },
): Promise<ResolvedGitHubAppInstallationHandlerTarget> {
  const { db, integrationRegistry, integrationsConfig } = ctx;

  const target = await resolveEnabledTargetOrThrow(db, input.targetKey);
  const definition = integrationRegistry.getDefinition({
    familyId: target.familyId,
    variantId: target.variantId,
  });

  if (definition === undefined) {
    throw new BadRequestError(
      input.invalidInputCode,
      `Integration definition '${target.familyId}/${target.variantId}' is not registered.`,
    );
  }

  if (
    !definition.connectionMethods.some(
      (method) => method.id === IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
    )
  ) {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.GITHUB_APP_INSTALLATION_NOT_SUPPORTED,
      `Integration target '${input.targetKey}' does not support GitHub App installation.`,
    );
  }

  const redirectHandler = definition.redirectHandler;
  if (redirectHandler === undefined) {
    throw new BadRequestError(
      IntegrationConnectionsBadRequestCodes.GITHUB_APP_INSTALLATION_HANDLER_NOT_CONFIGURED,
      `Integration target '${input.targetKey}' does not define a GitHub App installation handler.`,
    );
  }

  const targetSecrets = resolveIntegrationTargetSecrets({
    integrationsConfig,
    target: {
      targetKey: target.targetKey,
      secrets: target.secrets,
    },
  });

  let parsedConfig: Record<string, unknown>;
  try {
    const parsedConfigCandidate = definition.targetConfigSchema.parse(target.config);
    const targetConfigRecord = toUnknownRecord(parsedConfigCandidate);
    if (targetConfigRecord === null) {
      throw new Error("Target config must be an object.");
    }
    parsedConfig = targetConfigRecord;
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new BadRequestError(
        input.invalidInputCode,
        `Integration target '${input.targetKey}' has invalid target config for '${target.familyId}/${target.variantId}'.`,
      );
    }

    throw error;
  }

  let parsedSecrets: Record<string, string>;
  try {
    const parsedSecretsCandidate = definition.targetSecretSchema.parse(targetSecrets);
    const targetSecretsRecord = toStringRecord(parsedSecretsCandidate);
    if (targetSecretsRecord === null) {
      throw new Error("Target secrets must be a string record.");
    }
    parsedSecrets = targetSecretsRecord;
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new BadRequestError(
        input.invalidInputCode,
        `Integration target '${input.targetKey}' has invalid target secrets for '${target.familyId}/${target.variantId}'.`,
      );
    }

    throw error;
  }

  return {
    target: {
      targetKey: target.targetKey,
      familyId: target.familyId,
      variantId: target.variantId,
      enabled: true,
      config: parsedConfig,
      secrets: parsedSecrets,
    },
    redirectHandler,
  };
}
