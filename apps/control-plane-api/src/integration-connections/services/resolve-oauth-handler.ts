import type { IntegrationTarget } from "@mistle/db/control-plane";
import {
  IntegrationSupportedAuthSchemes,
  type IntegrationOAuthHandler,
} from "@mistle/integrations-core";
import { createIntegrationRegistry } from "@mistle/integrations-definitions";
import { z } from "zod";

import type { AppContext } from "../../types.js";
import {
  IntegrationConnectionsBadRequestCodes,
  IntegrationConnectionsBadRequestError,
  IntegrationConnectionsNotFoundCodes,
  IntegrationConnectionsNotFoundError,
} from "./errors.js";

const registry = createIntegrationRegistry();

export type ResolvedOauthHandlerTarget = {
  target: {
    targetKey: string;
    familyId: string;
    variantId: string;
    enabled: true;
    config: Record<string, unknown>;
  };
  oauthHandler: IntegrationOAuthHandler<Record<string, unknown>>;
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

  try {
    const parsedConfig = definition.targetConfigSchema.parse(target.config);

    return {
      target: {
        targetKey: target.targetKey,
        familyId: target.familyId,
        variantId: target.variantId,
        enabled: true,
        config: parsedConfig,
      },
      oauthHandler,
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new IntegrationConnectionsBadRequestError(
        input.invalidInputCode,
        `Integration target '${input.targetKey}' has invalid target config for '${target.familyId}/${target.variantId}'.`,
      );
    }

    throw error;
  }
}
