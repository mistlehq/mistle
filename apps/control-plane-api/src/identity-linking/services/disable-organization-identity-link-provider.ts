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

export async function disableOrganizationIdentityLinkProvider(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
  },
  input: {
    organizationId: string;
    actorUserId: string;
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

  const [updatedConfig] = await ctx.db
    .update(organizationIdentityLinkProviderConfigs)
    .set({
      status: OrganizationIdentityLinkProviderConfigStatus.DISABLED,
      updatedByUserId: input.actorUserId,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(organizationIdentityLinkProviderConfigs.organizationId, input.organizationId),
        eq(organizationIdentityLinkProviderConfigs.providerFamily, input.providerFamily),
      ),
    )
    .returning({
      providerFamily: organizationIdentityLinkProviderConfigs.providerFamily,
    });

  if (updatedConfig === undefined) {
    throw new NotFoundError(
      IdentityLinkingNotFoundCodes.PROVIDER_CONFIG_NOT_FOUND,
      `Identity-linking provider '${input.providerFamily}' is not configured for this organization.`,
    );
  }

  const configuredProvider = (
    await listOrganizationIdentityLinkProviders(ctx, {
      organizationId: input.organizationId,
    })
  ).find((entry) => entry.providerFamily === input.providerFamily);

  if (configuredProvider === undefined) {
    throw new Error(
      `Failed to load organization identity-link provider '${input.providerFamily}' after disable.`,
    );
  }

  return configuredProvider;
}
