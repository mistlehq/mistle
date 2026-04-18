import {
  organizationIdentityLinkProviderConfigs,
  OrganizationIdentityLinkProviderConfigStatus,
  type ControlPlaneDatabase,
} from "@mistle/db/control-plane";
import { NotFoundError } from "@mistle/http/errors.js";
import type { IntegrationRegistry } from "@mistle/integrations-core";
import { and, eq, sql } from "drizzle-orm";

import { IdentityLinkingNotFoundCodes } from "../constants.js";
import { listOrganizationIdentityLinkProviders } from "./list-organization-identity-link-providers.js";
import { listIdentityLinkProviderMetadata } from "./provider-metadata.js";
import { resolveValidatedProviderConnectionOrThrow } from "./resolve-validated-provider-connection.js";

export async function putOrganizationIdentityLinkProviderStatus(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
  },
  input: {
    organizationId: string;
    actorUserId: string;
    providerFamily: string;
    status:
      | typeof OrganizationIdentityLinkProviderConfigStatus.ACTIVE
      | typeof OrganizationIdentityLinkProviderConfigStatus.DISABLED;
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

  const existingConfig = await ctx.db.query.organizationIdentityLinkProviderConfigs.findFirst({
    columns: {
      providerFamily: true,
      integrationConnectionId: true,
    },
    where: (table, { and, eq }) =>
      and(
        eq(table.organizationId, input.organizationId),
        eq(table.providerFamily, input.providerFamily),
      ),
  });

  if (existingConfig === undefined) {
    throw new NotFoundError(
      IdentityLinkingNotFoundCodes.PROVIDER_CONFIG_NOT_FOUND,
      `Identity-linking provider '${input.providerFamily}' is not configured for this organization.`,
    );
  }

  if (input.status === OrganizationIdentityLinkProviderConfigStatus.ACTIVE) {
    await resolveValidatedProviderConnectionOrThrow(
      {
        db: ctx.db,
        integrationRegistry: ctx.integrationRegistry,
      },
      {
        organizationId: input.organizationId,
        integrationConnectionId: existingConfig.integrationConnectionId,
        provider,
      },
    );
  }

  await ctx.db
    .update(organizationIdentityLinkProviderConfigs)
    .set({
      status: input.status,
      updatedByUserId: input.actorUserId,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(organizationIdentityLinkProviderConfigs.organizationId, input.organizationId),
        eq(organizationIdentityLinkProviderConfigs.providerFamily, input.providerFamily),
      ),
    );

  const configuredProvider = (
    await listOrganizationIdentityLinkProviders(ctx, {
      organizationId: input.organizationId,
    })
  ).find((entry) => entry.providerFamily === input.providerFamily);

  if (configuredProvider === undefined) {
    throw new Error(
      `Failed to load organization identity-link provider '${input.providerFamily}' after status update.`,
    );
  }

  return configuredProvider;
}
