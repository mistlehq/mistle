import {
  organizationIdentityLinkProviderConfigs,
  OrganizationIdentityLinkProviderConfigStatus,
  type ControlPlaneDatabase,
} from "@mistle/db/control-plane";
import { NotFoundError } from "@mistle/http/errors.js";
import type { IntegrationRegistry } from "@mistle/integrations-core";
import { sql } from "drizzle-orm";

import { IdentityLinkingNotFoundCodes } from "../constants.js";
import { listOrganizationIdentityLinkProviders } from "./list-organization-identity-link-providers.js";
import { listIdentityLinkProviderMetadata } from "./provider-metadata.js";
import { resolveValidatedProviderConnectionOrThrow } from "./resolve-validated-provider-connection.js";

export async function putOrganizationIdentityLinkProvider(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
  },
  input: {
    organizationId: string;
    actorUserId: string;
    providerFamily: string;
    integrationConnectionId: string;
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

  const connection = await resolveValidatedProviderConnectionOrThrow(
    {
      db: ctx.db,
      integrationRegistry: ctx.integrationRegistry,
    },
    {
      organizationId: input.organizationId,
      integrationConnectionId: input.integrationConnectionId,
      provider,
    },
  );

  const existingConfig = await ctx.db.query.organizationIdentityLinkProviderConfigs.findFirst({
    columns: {
      status: true,
    },
    where: (table, { and, eq }) =>
      and(
        eq(table.organizationId, input.organizationId),
        eq(table.providerFamily, input.providerFamily),
      ),
  });

  const nextStatus =
    existingConfig?.status ?? OrganizationIdentityLinkProviderConfigStatus.DISABLED;

  await ctx.db
    .insert(organizationIdentityLinkProviderConfigs)
    .values({
      organizationId: input.organizationId,
      providerFamily: provider.providerFamily,
      status: nextStatus,
      integrationTargetKey: connection.targetKey,
      integrationConnectionId: input.integrationConnectionId,
      createdByUserId: input.actorUserId,
      updatedByUserId: input.actorUserId,
    })
    .onConflictDoUpdate({
      target: [
        organizationIdentityLinkProviderConfigs.organizationId,
        organizationIdentityLinkProviderConfigs.providerFamily,
      ],
      set: {
        status: nextStatus,
        integrationTargetKey: connection.targetKey,
        integrationConnectionId: input.integrationConnectionId,
        updatedByUserId: input.actorUserId,
        updatedAt: sql`now()`,
      },
    });

  const configuredProvider = (
    await listOrganizationIdentityLinkProviders(ctx, {
      organizationId: input.organizationId,
    })
  ).find((entry) => entry.providerFamily === input.providerFamily);

  if (configuredProvider === undefined) {
    throw new Error(
      `Failed to load organization identity-link provider '${input.providerFamily}' after upsert.`,
    );
  }

  return configuredProvider;
}
