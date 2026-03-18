import type { IntegrationTarget } from "@mistle/db/control-plane";
import {
  IntegrationConnectionMethodIds,
  type IntegrationOAuth2Capability,
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

export type ResolvedOAuth2CapabilityTarget = {
  target: {
    targetKey: string;
    familyId: string;
    variantId: string;
    enabled: true;
    config: Record<string, unknown>;
    secrets: Record<string, string>;
  };
  oauth2: IntegrationOAuth2Capability<
    Record<string, unknown>,
    Record<string, string>,
    Record<string, unknown>
  >;
};

export async function resolveOAuth2CapabilityTargetOrThrow(
  db: AppContext["var"]["db"],
  integrationsConfig: AppContext["var"]["config"]["integrations"],
  input: {
    targetKey: string;
    invalidInputCode:
      | typeof IntegrationConnectionsBadRequestCodes.INVALID_OAUTH2_START_INPUT
      | typeof IntegrationConnectionsBadRequestCodes.INVALID_OAUTH2_COMPLETE_INPUT;
  },
): Promise<ResolvedOAuth2CapabilityTarget> {
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
      (method) => method.id === IntegrationConnectionMethodIds.OAUTH2,
    )
  ) {
    throw new IntegrationConnectionsBadRequestError(
      IntegrationConnectionsBadRequestCodes.OAUTH2_NOT_SUPPORTED,
      `Integration target '${input.targetKey}' does not support OAuth2.`,
    );
  }

  const oauth2 = definition.oauth2;
  if (oauth2 === undefined) {
    throw new IntegrationConnectionsBadRequestError(
      IntegrationConnectionsBadRequestCodes.OAUTH2_CAPABILITY_NOT_CONFIGURED,
      `Integration target '${input.targetKey}' does not define an OAuth2 capability.`,
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
    oauth2,
  };
}
