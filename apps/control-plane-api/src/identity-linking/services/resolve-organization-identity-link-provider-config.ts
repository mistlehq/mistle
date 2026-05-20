import { type ControlPlaneDatabase } from "@mistle/db/control-plane";
import { BadRequestError, NotFoundError } from "@mistle/http/errors.js";
import type { IntegrationRegistry } from "@mistle/integrations-core";

import { IdentityLinkingBadRequestCodes, IdentityLinkingNotFoundCodes } from "../constants.js";
import { listIdentityLinkProviderMetadata } from "./provider-metadata.js";

export type ResolvedOrganizationIdentityLinkProviderConfig = {
  id: string;
  providerFamily: string;
  status: "active" | "disabled";
  integrationTargetKey: string;
  integrationConnectionId: string;
};

export async function resolveIdentityLinkProviderMetadataOrThrow(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
  },
  input: {
    providerFamily: string;
  },
) {
  const providers = await listIdentityLinkProviderMetadata(ctx);
  const provider = providers.find((entry) => entry.providerFamily === input.providerFamily);

  if (provider === undefined) {
    throw new NotFoundError(
      IdentityLinkingNotFoundCodes.PROVIDER_NOT_FOUND,
      `Identity-linking provider '${input.providerFamily}' was not found.`,
    );
  }

  return provider;
}

export async function resolveOrganizationIdentityLinkProviderConfigByIdOrThrow(
  ctx: {
    db: ControlPlaneDatabase;
  },
  input: {
    organizationId: string;
    organizationProviderConfigId: string;
  },
): Promise<ResolvedOrganizationIdentityLinkProviderConfig> {
  const config = await ctx.db.query.organizationIdentityLinkProviderConfigs.findFirst({
    columns: {
      id: true,
      providerFamily: true,
      status: true,
      integrationTargetKey: true,
      integrationConnectionId: true,
    },
    where: (table, { and, eq }) =>
      and(
        eq(table.organizationId, input.organizationId),
        eq(table.id, input.organizationProviderConfigId),
      ),
  });

  if (config === undefined) {
    throw new NotFoundError(
      IdentityLinkingNotFoundCodes.PROVIDER_CONFIG_NOT_FOUND,
      `Identity-linking provider config '${input.organizationProviderConfigId}' was not found.`,
    );
  }

  return config;
}

export async function resolveExactOneOrganizationIdentityLinkProviderConfigForFamilyOrThrow(
  ctx: {
    db: ControlPlaneDatabase;
  },
  input: {
    organizationId: string;
    providerFamily: string;
  },
): Promise<ResolvedOrganizationIdentityLinkProviderConfig> {
  const configs = await ctx.db.query.organizationIdentityLinkProviderConfigs.findMany({
    columns: {
      id: true,
      providerFamily: true,
      status: true,
      integrationTargetKey: true,
      integrationConnectionId: true,
    },
    where: (table, { and, eq }) =>
      and(
        eq(table.organizationId, input.organizationId),
        eq(table.providerFamily, input.providerFamily),
      ),
    limit: 2,
  });

  if (configs.length === 0) {
    throw new NotFoundError(
      IdentityLinkingNotFoundCodes.PROVIDER_CONFIG_NOT_FOUND,
      `Identity-linking provider '${input.providerFamily}' is not configured for this organization.`,
    );
  }

  if (configs.length > 1) {
    throw new BadRequestError(
      IdentityLinkingBadRequestCodes.PROVIDER_CONFIG_AMBIGUOUS,
      `Identity-linking provider '${input.providerFamily}' has multiple configs. Use a provider-config endpoint instead.`,
    );
  }

  return configs[0]!;
}
