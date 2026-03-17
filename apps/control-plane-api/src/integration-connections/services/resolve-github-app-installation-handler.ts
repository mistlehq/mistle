import type { IntegrationTarget } from "@mistle/db/control-plane";
import {
  IntegrationConnectionMethodIds,
  type IntegrationOAuthHandler,
} from "@mistle/integrations-core";
import { createIntegrationRegistry } from "@mistle/integrations-definitions";
import { z } from "zod";

import { resolveIntegrationTargetSecrets } from "../../integration-targets/services/resolve-target-secrets.js";
import type { AppContext } from "../../types.js";
import {
  IntegrationConnectionsBadRequestCodes,
  IntegrationConnectionsBadRequestError,
  IntegrationConnectionsNotFoundCodes,
  IntegrationConnectionsNotFoundError,
} from "./errors.js";

const registry = createIntegrationRegistry();

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
  redirectHandler: IntegrationOAuthHandler<Record<string, unknown>, Record<string, string>>;
};

async function resolveEnabledTargetOrThrow(
  db: AppContext["var"]["db"],
  targetKey: string,
): Promise<IntegrationTarget> {
  const target = await db.query.integrationTargets.findFirst({
    where: (table, { and, eq }) => and(eq(table.targetKey, targetKey), eq(table.enabled, true)),
  });

  if (target === undefined) {
    throw new IntegrationConnectionsNotFoundError(
      IntegrationConnectionsNotFoundCodes.TARGET_NOT_FOUND,
      `Integration target '${targetKey}' was not found.`,
    );
  }

  return target;
}

export async function resolveGitHubAppInstallationHandlerTargetOrThrow(
  db: AppContext["var"]["db"],
  integrationsConfig: AppContext["var"]["config"]["integrations"],
  input: {
    targetKey: string;
    invalidInputCode:
      | typeof IntegrationConnectionsBadRequestCodes.INVALID_GITHUB_APP_INSTALLATION_START_INPUT
      | typeof IntegrationConnectionsBadRequestCodes.INVALID_GITHUB_APP_INSTALLATION_COMPLETE_INPUT;
  },
): Promise<ResolvedGitHubAppInstallationHandlerTarget> {
  const target = await resolveEnabledTargetOrThrow(db, input.targetKey);
  const definition = registry.getDefinition({
    familyId: target.familyId,
    variantId: target.variantId,
  });

  if (definition === undefined) {
    throw new IntegrationConnectionsBadRequestError(
      input.invalidInputCode,
      `Integration definition '${target.familyId}/${target.variantId}' is not registered.`,
    );
  }

  if (
    !definition.connectionMethods.some(
      (method) => method.id === IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
    )
  ) {
    throw new IntegrationConnectionsBadRequestError(
      IntegrationConnectionsBadRequestCodes.GITHUB_APP_INSTALLATION_NOT_SUPPORTED,
      `Integration target '${input.targetKey}' does not support GitHub App installation.`,
    );
  }

  const redirectHandler = definition.authHandlers?.oauth;
  if (redirectHandler === undefined) {
    throw new IntegrationConnectionsBadRequestError(
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
      throw new IntegrationConnectionsBadRequestError(
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
      throw new IntegrationConnectionsBadRequestError(
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
