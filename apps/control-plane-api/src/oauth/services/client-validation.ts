import type { ControlPlaneDatabase, OAuthGrantType } from "@mistle/db/control-plane";
import {
  OAuthApplicationTypes,
  OAuthClientRegistrationKinds,
  OAuthClientTypes,
} from "@mistle/db/control-plane";
import { BadRequestError } from "@mistle/http/errors.js";

import {
  isOrganizationPermission,
  type OrganizationPermission,
} from "../../auth/services/organization-policy.js";
import { MistleCliOAuthClient } from "../clients.js";
import { McpOAuthScopes } from "../well-known/protected-resource.js";
import { OAuthErrorCodes } from "./authorization-code.js";

export type RequiredOAuthClient = {
  id: string;
  clientId: string;
  name: string;
  registrationKind:
    | typeof OAuthClientRegistrationKinds.STATIC
    | typeof OAuthClientRegistrationKinds.DYNAMIC;
  permissions: readonly OrganizationPermission[];
};

const McpOAuthScopeSet = new Set<string>(McpOAuthScopes);

export async function requireOAuthClient(input: {
  db: ControlPlaneDatabase;
  clientId: string;
  grantType: OAuthGrantType;
  redirectUri?: string;
}): Promise<RequiredOAuthClient> {
  const client = await input.db.query.oauthClients.findFirst({
    where: (table, { eq }) => eq(table.clientId, input.clientId),
  });
  if (client === undefined || client.disabledAt !== null) {
    throw unauthorizedClient("OAuth client is not allowed.");
  }
  if (
    client.clientType !== OAuthClientTypes.PUBLIC ||
    client.applicationType !== OAuthApplicationTypes.NATIVE ||
    (client.registrationKind !== OAuthClientRegistrationKinds.STATIC &&
      client.registrationKind !== OAuthClientRegistrationKinds.DYNAMIC)
  ) {
    throw unauthorizedClient("OAuth client is not allowed.");
  }

  await requireConfiguredGrantType({
    db: input.db,
    oauthClientId: client.id,
    grantType: input.grantType,
  });
  if (input.redirectUri !== undefined) {
    await requireConfiguredRedirectUri({
      db: input.db,
      oauthClientId: client.id,
      clientId: client.clientId,
      registrationKind: client.registrationKind,
      redirectUri: input.redirectUri,
    });
  }

  const permissions = await readConfiguredClientPermissions({
    db: input.db,
    oauthClientId: client.id,
    registrationKind: client.registrationKind,
  });

  return {
    id: client.id,
    clientId: client.clientId,
    name: client.name,
    registrationKind: client.registrationKind,
    permissions,
  };
}

async function requireConfiguredGrantType(input: {
  db: ControlPlaneDatabase;
  oauthClientId: string;
  grantType: OAuthGrantType;
}): Promise<void> {
  const grantType = await input.db.query.oauthClientGrantTypes.findFirst({
    columns: {
      grantType: true,
    },
    where: (table, { and, eq }) =>
      and(eq(table.oauthClientId, input.oauthClientId), eq(table.grantType, input.grantType)),
  });
  if (grantType === undefined) {
    throw unauthorizedClient(`OAuth client cannot use ${input.grantType} grants.`);
  }
}

async function requireConfiguredRedirectUri(input: {
  db: ControlPlaneDatabase;
  oauthClientId: string;
  clientId: string;
  registrationKind:
    | typeof OAuthClientRegistrationKinds.STATIC
    | typeof OAuthClientRegistrationKinds.DYNAMIC;
  redirectUri: string;
}): Promise<void> {
  if (
    input.registrationKind === OAuthClientRegistrationKinds.STATIC &&
    input.clientId === MistleCliOAuthClient.clientId
  ) {
    await requireMistleCliRedirectUri({ db: input.db, redirectUri: input.redirectUri });
    return;
  }

  const redirectUri = await input.db.query.oauthClientRedirectUris.findFirst({
    columns: {
      redirectUri: true,
    },
    where: (table, { and, eq }) =>
      and(eq(table.oauthClientId, input.oauthClientId), eq(table.redirectUri, input.redirectUri)),
  });
  if (redirectUri === undefined) {
    throw new BadRequestError(OAuthErrorCodes.INVALID_REQUEST, "Redirect URI is invalid.");
  }
}

async function requireMistleCliRedirectUri(input: {
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
    throw unauthorizedClient("OAuth client is not allowed.");
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

async function readConfiguredClientPermissions(input: {
  db: ControlPlaneDatabase;
  oauthClientId: string;
  registrationKind:
    | typeof OAuthClientRegistrationKinds.STATIC
    | typeof OAuthClientRegistrationKinds.DYNAMIC;
}): Promise<OrganizationPermission[]> {
  const scopes = await input.db.query.oauthClientScopes.findMany({
    columns: {
      scope: true,
    },
    where: (table, { eq }) => eq(table.oauthClientId, input.oauthClientId),
  });
  const permissions: OrganizationPermission[] = [];
  for (const scope of scopes) {
    if (!isOrganizationPermission(scope.scope)) {
      throw unauthorizedClient("OAuth client has an invalid configured scope.");
    }
    if (
      input.registrationKind === OAuthClientRegistrationKinds.DYNAMIC &&
      !McpOAuthScopeSet.has(scope.scope)
    ) {
      throw unauthorizedClient("Dynamic OAuth client has an invalid configured scope.");
    }

    permissions.push(scope.scope);
  }

  if (permissions.length === 0) {
    throw unauthorizedClient("OAuth client has no configured scopes.");
  }

  return permissions;
}

function unauthorizedClient(message: string): BadRequestError {
  return new BadRequestError(OAuthErrorCodes.UNAUTHORIZED_CLIENT, message);
}
