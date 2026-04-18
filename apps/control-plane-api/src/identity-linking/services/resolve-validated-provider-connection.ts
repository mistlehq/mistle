import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import { BadRequestError, NotFoundError } from "@mistle/http/errors.js";

import { IdentityLinkingBadRequestCodes, IdentityLinkingNotFoundCodes } from "../constants.js";
import type { IdentityLinkProviderMetadata } from "./provider-metadata.js";

export async function resolveValidatedProviderConnectionOrThrow(
  ctx: {
    db: ControlPlaneDatabase;
  },
  input: {
    organizationId: string;
    integrationConnectionId: string;
    provider: IdentityLinkProviderMetadata;
  },
) {
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

  if (!input.provider.eligibleTargetKeys.includes(connection.targetKey)) {
    throw new BadRequestError(
      IdentityLinkingBadRequestCodes.INVALID_PROVIDER_CONFIG_INPUT,
      `Integration connection '${input.integrationConnectionId}' does not belong to identity-linking provider '${input.provider.providerFamily}'.`,
    );
  }

  const rawConnectionMethodId = connection.config?.["connection_method"];
  if (typeof rawConnectionMethodId !== "string" || rawConnectionMethodId.length === 0) {
    throw new BadRequestError(
      IdentityLinkingBadRequestCodes.INVALID_PROVIDER_CONFIG_INPUT,
      `Integration connection '${input.integrationConnectionId}' is missing a connection method.`,
    );
  }

  if (!input.provider.eligibleConnectionMethodIds.includes(rawConnectionMethodId)) {
    throw new BadRequestError(
      IdentityLinkingBadRequestCodes.INVALID_PROVIDER_CONFIG_INPUT,
      `Integration connection '${input.integrationConnectionId}' uses connection method '${rawConnectionMethodId}', which is not eligible for identity linking provider '${input.provider.providerFamily}'.`,
    );
  }

  return connection;
}
