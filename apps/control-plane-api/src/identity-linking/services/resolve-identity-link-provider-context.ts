import type {
  ControlPlaneDatabase,
  OrganizationIdentityLinkProviderConfigStatus,
} from "@mistle/db/control-plane";
import { BadRequestError, NotFoundError } from "@mistle/http/errors.js";
import type { IntegrationRegistry } from "@mistle/integrations-core";

import { IdentityLinkingBadRequestCodes, IdentityLinkingNotFoundCodes } from "../constants.js";
import type { IdentityLinkProviderMetadata } from "./provider-metadata.js";
import { listIdentityLinkProviderMetadata } from "./provider-metadata.js";
import { resolveValidatedProviderConnectionOrThrow } from "./resolve-validated-provider-connection.js";

export async function resolveIdentityLinkProviderContextOrThrow(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
  },
  input: {
    organizationId: string;
    providerFamily: string;
    requiredConfigStatus?: OrganizationIdentityLinkProviderConfigStatus;
    organizationProviderConfigId?: string;
    integrationConnectionId?: string;
  },
): Promise<{
  provider: IdentityLinkProviderMetadata;
  organizationProviderConfig: NonNullable<
    Awaited<ReturnType<typeof ctx.db.query.organizationIdentityLinkProviderConfigs.findFirst>>
  >;
  integrationConnection: NonNullable<
    Awaited<ReturnType<typeof ctx.db.query.integrationConnections.findFirst>>
  >;
  integrationTarget: NonNullable<
    Awaited<ReturnType<typeof ctx.db.query.integrationTargets.findFirst>>
  >;
}> {
  const providers = await listIdentityLinkProviderMetadata(ctx);
  const provider = providers.find((candidate) => candidate.providerFamily === input.providerFamily);

  if (provider === undefined) {
    throw new NotFoundError(
      IdentityLinkingNotFoundCodes.PROVIDER_NOT_FOUND,
      `Identity-linking provider '${input.providerFamily}' was not found.`,
    );
  }

  const organizationProviderConfig =
    await ctx.db.query.organizationIdentityLinkProviderConfigs.findFirst({
      where: (table, { and, eq }) =>
        and(
          eq(table.organizationId, input.organizationId),
          eq(table.providerFamily, input.providerFamily),
          ...(input.requiredConfigStatus === undefined
            ? []
            : [eq(table.status, input.requiredConfigStatus)]),
          ...(input.organizationProviderConfigId === undefined
            ? []
            : [eq(table.id, input.organizationProviderConfigId)]),
        ),
    });

  if (organizationProviderConfig === undefined) {
    throw new NotFoundError(
      IdentityLinkingNotFoundCodes.PROVIDER_CONFIG_NOT_FOUND,
      `Identity-linking provider '${input.providerFamily}' is not configured for this organization.`,
    );
  }

  if (
    input.integrationConnectionId !== undefined &&
    organizationProviderConfig.integrationConnectionId !== input.integrationConnectionId
  ) {
    throw new BadRequestError(
      IdentityLinkingBadRequestCodes.INVALID_PROVIDER_CONFIG_INPUT,
      `Identity-linking provider '${input.providerFamily}' no longer references integration connection '${input.integrationConnectionId}'.`,
    );
  }

  const validatedIntegrationConnection = await resolveValidatedProviderConnectionOrThrow(
    {
      db: ctx.db,
      integrationRegistry: ctx.integrationRegistry,
    },
    {
      organizationId: input.organizationId,
      integrationConnectionId: organizationProviderConfig.integrationConnectionId,
      provider,
    },
  );

  const integrationConnection = await ctx.db.query.integrationConnections.findFirst({
    where: (table, { eq }) => eq(table.id, validatedIntegrationConnection.id),
  });

  if (integrationConnection === undefined) {
    throw new NotFoundError(
      IdentityLinkingNotFoundCodes.CONNECTION_NOT_FOUND,
      `Integration connection '${validatedIntegrationConnection.id}' was not found.`,
    );
  }

  const integrationTarget = await ctx.db.query.integrationTargets.findFirst({
    where: (table, { eq }) => eq(table.targetKey, integrationConnection.targetKey),
  });

  if (integrationTarget === undefined) {
    throw new NotFoundError(
      IdentityLinkingNotFoundCodes.PROVIDER_NOT_FOUND,
      `Integration target '${integrationConnection.targetKey}' was not found.`,
    );
  }

  return {
    provider,
    organizationProviderConfig,
    integrationConnection,
    integrationTarget,
  };
}
