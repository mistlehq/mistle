import { type ControlPlaneDatabase, getControlPlaneDatabaseSchema } from "@mistle/db/control-plane";
import { BadRequestError, NotFoundError } from "@mistle/http/errors.js";
import type { IntegrationRegistry } from "@mistle/integrations-core";
import { eq } from "drizzle-orm";

import { IdentityLinkingBadRequestCodes, IdentityLinkingNotFoundCodes } from "../constants.js";
import {
  resolveIdentityLinkingDefinitionOrThrow,
  supportsIdentityLinkingConnection,
} from "./identity-linking-definition.js";
import type { IdentityLinkProviderMetadata } from "./provider-metadata.js";

export async function resolveValidatedProviderConnectionOrThrow(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
  },
  input: {
    organizationId: string;
    integrationConnectionId: string;
    provider: IdentityLinkProviderMetadata;
  },
) {
  const tables = getControlPlaneDatabaseSchema(ctx.db);

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

  const credentialLinks = await ctx.db
    .select({
      slotKey: tables.integrationConnectionCredentials.slotKey,
    })
    .from(tables.integrationConnectionCredentials)
    .where(eq(tables.integrationConnectionCredentials.connectionId, connection.id));
  const credentialSlotKeys = new Set(
    credentialLinks.map((credentialLink) => credentialLink.slotKey),
  );

  const definition = resolveIdentityLinkingDefinitionOrThrow({
    integrationRegistry: ctx.integrationRegistry,
    target: {
      targetKey: connection.targetKey,
      familyId: input.provider.familyId,
      variantId: input.provider.variantId,
    },
  });

  if (
    !(await supportsIdentityLinkingConnection({
      definition,
      connection,
      availableConnectionSecretSlotKeys: credentialSlotKeys,
    }))
  ) {
    throw new BadRequestError(
      IdentityLinkingBadRequestCodes.INVALID_PROVIDER_CONFIG_INPUT,
      `Integration connection '${input.integrationConnectionId}' is missing required linked-user authorization configuration for identity linking.`,
    );
  }

  return connection;
}
