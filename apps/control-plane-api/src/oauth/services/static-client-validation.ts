import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import {
  OAuthApplicationTypes,
  OAuthClientRegistrationKinds,
  OAuthClientTypes,
  type OAuthGrantType,
} from "@mistle/db/control-plane";
import { BadRequestError } from "@mistle/http/errors.js";

import {
  isOrganizationPermission,
  type OrganizationPermission,
} from "../../auth/services/organization-policy.js";
import { MistleCliOAuthClient } from "../clients.js";
import { OAuthErrorCodes } from "./authorization-code.js";

export async function requireMistleCliOAuthClient(input: {
  db: ControlPlaneDatabase;
  clientId: string;
  grantType: OAuthGrantType;
}): Promise<{ id: string; permissions: readonly OrganizationPermission[] }> {
  if (input.clientId !== MistleCliOAuthClient.clientId) {
    throw new BadRequestError(OAuthErrorCodes.UNAUTHORIZED_CLIENT, "OAuth client is not allowed.");
  }

  const client = await input.db.query.oauthClients.findFirst({
    where: (table, { eq }) => eq(table.clientId, input.clientId),
  });
  if (client === undefined || client.disabledAt !== null) {
    throw new BadRequestError(OAuthErrorCodes.UNAUTHORIZED_CLIENT, "OAuth client is not allowed.");
  }
  if (
    client.clientType !== OAuthClientTypes.PUBLIC ||
    client.applicationType !== OAuthApplicationTypes.NATIVE ||
    client.registrationKind !== OAuthClientRegistrationKinds.STATIC
  ) {
    throw new BadRequestError(OAuthErrorCodes.UNAUTHORIZED_CLIENT, "OAuth client is not allowed.");
  }

  const grantType = await input.db.query.oauthClientGrantTypes.findFirst({
    columns: {
      grantType: true,
    },
    where: (table, { and, eq }) =>
      and(eq(table.oauthClientId, client.id), eq(table.grantType, input.grantType)),
  });
  if (grantType === undefined) {
    throw new BadRequestError(
      OAuthErrorCodes.UNAUTHORIZED_CLIENT,
      `OAuth client cannot use ${input.grantType} grants.`,
    );
  }

  const scopes = await input.db.query.oauthClientScopes.findMany({
    columns: {
      scope: true,
    },
    where: (table, { eq }) => eq(table.oauthClientId, client.id),
  });
  const permissions: OrganizationPermission[] = [];
  for (const scope of scopes) {
    if (!isOrganizationPermission(scope.scope)) {
      throw new BadRequestError(
        OAuthErrorCodes.UNAUTHORIZED_CLIENT,
        "OAuth client has an invalid configured scope.",
      );
    }

    permissions.push(scope.scope);
  }

  if (permissions.length === 0) {
    throw new BadRequestError(
      OAuthErrorCodes.UNAUTHORIZED_CLIENT,
      "OAuth client has no configured scopes.",
    );
  }

  return {
    id: client.id,
    permissions,
  };
}

export async function validateMistleCliRedirectUri(input: {
  db: ControlPlaneDatabase;
  redirectUri: string;
}): Promise<void> {
  const redirectUrl = new URL(input.redirectUri);
  if (
    redirectUrl.protocol !== "http:" ||
    redirectUrl.hostname !== "127.0.0.1" ||
    redirectUrl.port.length === 0 ||
    redirectUrl.pathname !== "/callback" ||
    redirectUrl.search.length !== 0 ||
    redirectUrl.hash.length !== 0
  ) {
    throw new BadRequestError(OAuthErrorCodes.INVALID_REQUEST, "Redirect URI is invalid.");
  }

  const client = await input.db.query.oauthClients.findFirst({
    columns: {
      id: true,
    },
    where: (table, { eq }) => eq(table.clientId, MistleCliOAuthClient.clientId),
  });
  if (client === undefined) {
    throw new BadRequestError(OAuthErrorCodes.UNAUTHORIZED_CLIENT, "OAuth client is not allowed.");
  }

  const redirectUri = await input.db.query.oauthClientRedirectUris.findFirst({
    columns: {
      redirectUri: true,
    },
    where: (table, { and, eq }) =>
      and(eq(table.oauthClientId, client.id), eq(table.redirectUri, "http://127.0.0.1/callback")),
  });
  if (redirectUri === undefined) {
    throw new BadRequestError(OAuthErrorCodes.INVALID_REQUEST, "Redirect URI is invalid.");
  }
}
