import {
  organizationIdentityLinkProviderConfigs,
  OrganizationIdentityLinkProviderConfigStatus,
  type ControlPlaneDatabase,
} from "@mistle/db/control-plane";
import { BadRequestError, NotFoundError } from "@mistle/http/errors.js";
import type { IntegrationRegistry } from "@mistle/integrations-core";
import { sql } from "drizzle-orm";

import { IdentityLinkingBadRequestCodes, IdentityLinkingNotFoundCodes } from "../constants.js";
import { listOrganizationIdentityLinkProviders } from "./list-organization-identity-link-providers.js";
import { listIdentityLinkProviderMetadata } from "./provider-metadata.js";

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

  const connection = await ctx.db.query.integrationConnections.findFirst({
    columns: {
      id: true,
      targetKey: true,
      status: true,
      config: true,
    },
    where: (table, { and, eq }) =>
      and(
        eq(table.organizationId, input.organizationId),
        eq(table.id, input.integrationConnectionId),
      ),
  });

  if (connection === undefined) {
    throw new NotFoundError(
      IdentityLinkingNotFoundCodes.CONNECTION_NOT_FOUND,
      `Integration connection '${input.integrationConnectionId}' was not found.`,
    );
  }

  if (connection.status !== "active") {
    throw new BadRequestError(
      IdentityLinkingBadRequestCodes.INVALID_PROVIDER_CONFIG_INPUT,
      `Integration connection '${input.integrationConnectionId}' must be active to be used for identity linking.`,
    );
  }

  if (!provider.eligibleTargetKeys.includes(connection.targetKey)) {
    throw new BadRequestError(
      IdentityLinkingBadRequestCodes.INVALID_PROVIDER_CONFIG_INPUT,
      `Integration connection '${input.integrationConnectionId}' does not belong to identity-linking provider '${input.providerFamily}'.`,
    );
  }

  const rawConnectionMethodId = connection.config?.["connection_method"];
  if (typeof rawConnectionMethodId !== "string" || rawConnectionMethodId.length === 0) {
    throw new BadRequestError(
      IdentityLinkingBadRequestCodes.INVALID_PROVIDER_CONFIG_INPUT,
      `Integration connection '${input.integrationConnectionId}' is missing a connection method.`,
    );
  }

  if (!provider.eligibleConnectionMethodIds.includes(rawConnectionMethodId)) {
    throw new BadRequestError(
      IdentityLinkingBadRequestCodes.INVALID_PROVIDER_CONFIG_INPUT,
      `Integration connection '${input.integrationConnectionId}' uses connection method '${rawConnectionMethodId}', which is not eligible for identity linking provider '${input.providerFamily}'.`,
    );
  }

  await ctx.db
    .insert(organizationIdentityLinkProviderConfigs)
    .values({
      organizationId: input.organizationId,
      providerFamily: provider.providerFamily,
      status: OrganizationIdentityLinkProviderConfigStatus.ACTIVE,
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
        status: OrganizationIdentityLinkProviderConfigStatus.ACTIVE,
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
