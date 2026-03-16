import type { IntegrationTarget } from "@mistle/db/control-plane";
import {
  IntegrationSupportedAuthSchemes,
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
const OAuthHandlerConfigSchema = z.record(z.string(), z.unknown());
const OAuthHandlerSecretSchema = z.record(z.string(), z.string());

export type ResolvedOauthHandlerTarget = {
  target: {
    targetKey: string;
    familyId: string;
    variantId: string;
    enabled: true;
    config: Record<string, unknown>;
    secrets: Record<string, string>;
  };
  oauthHandler: IntegrationOAuthHandler<Record<string, unknown>, Record<string, string>>;
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

export async function resolveOauthHandlerTargetOrThrow(
  db: AppContext["var"]["db"],
  integrationsConfig: AppContext["var"]["config"]["integrations"],
  input: {
    targetKey: string;
    invalidInputCode:
      | typeof IntegrationConnectionsBadRequestCodes.INVALID_OAUTH_START_INPUT
      | typeof IntegrationConnectionsBadRequestCodes.INVALID_OAUTH_COMPLETE_INPUT;
  },
): Promise<ResolvedOauthHandlerTarget> {
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

  if (!definition.supportedAuthSchemes.includes(IntegrationSupportedAuthSchemes.OAUTH)) {
    throw new IntegrationConnectionsBadRequestError(
      IntegrationConnectionsBadRequestCodes.OAUTH_NOT_SUPPORTED,
      `Integration target '${input.targetKey}' does not support OAuth.`,
    );
  }

  const oauthHandler = definition.authHandlers?.oauth;
  if (oauthHandler === undefined) {
    throw new IntegrationConnectionsBadRequestError(
      IntegrationConnectionsBadRequestCodes.OAUTH_HANDLER_NOT_CONFIGURED,
      `Integration target '${input.targetKey}' does not define an OAuth handler.`,
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
    parsedConfig = OAuthHandlerConfigSchema.parse(parsedConfigCandidate);
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
    parsedSecrets = OAuthHandlerSecretSchema.parse(parsedSecretsCandidate);
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
    oauthHandler,
  };
}
