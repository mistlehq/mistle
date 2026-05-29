import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import {
  OAuthApplicationTypes,
  OAuthClientRegistrationKinds,
  OAuthClientTypes,
  OAuthGrantTypes,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";
import { BadRequestError } from "@mistle/http/errors.js";
import { typeid } from "typeid-js";

import type {
  OAuthClientRegistrationRequest,
  OAuthClientRegistrationResponse,
} from "../schemas.js";
import { McpOAuthScopes } from "../well-known/protected-resource.js";
import { OAuthErrorCodes } from "./authorization-code.js";

const McpOAuthScopeSet = new Set<string>(McpOAuthScopes);
type RegistrationGrantType =
  | typeof OAuthGrantTypes.AUTHORIZATION_CODE
  | typeof OAuthGrantTypes.REFRESH_TOKEN;

export async function registerDynamicOAuthClient(input: {
  db: ControlPlaneDatabase;
  request: OAuthClientRegistrationRequest;
}): Promise<OAuthClientRegistrationResponse> {
  const registration = validateDynamicClientRegistration(input.request);
  const clientId = typeid("oac").toString();
  const clientIdIssuedAt = Math.floor(Date.now() / 1000);

  await input.db.transaction(async (tx) => {
    const tables = getControlPlaneDatabaseSchema(tx);
    const [client] = await tx
      .insert(tables.oauthClients)
      .values({
        clientId,
        name: registration.clientName,
        clientType: OAuthClientTypes.PUBLIC,
        applicationType: OAuthApplicationTypes.NATIVE,
        registrationKind: OAuthClientRegistrationKinds.DYNAMIC,
      })
      .returning({ id: tables.oauthClients.id });
    if (client === undefined) {
      throw new Error("Failed to register OAuth client.");
    }

    await tx.insert(tables.oauthClientRedirectUris).values(
      registration.redirectUris.map((redirectUri) => ({
        oauthClientId: client.id,
        redirectUri,
      })),
    );
    await tx.insert(tables.oauthClientGrantTypes).values(
      registration.grantTypes.map((grantType) => ({
        oauthClientId: client.id,
        grantType,
      })),
    );
    await tx.insert(tables.oauthClientScopes).values(
      registration.scopes.map((scope) => ({
        oauthClientId: client.id,
        scope,
      })),
    );
  });

  return {
    client_id: clientId,
    client_name: registration.clientName,
    redirect_uris: registration.redirectUris,
    grant_types: registration.grantTypes,
    response_types: registration.responseTypes,
    scope: registration.scopes.join(" "),
    token_endpoint_auth_method: "none",
    client_id_issued_at: clientIdIssuedAt,
  };
}

function validateDynamicClientRegistration(request: OAuthClientRegistrationRequest): {
  clientName: string;
  redirectUris: string[];
  grantTypes: RegistrationGrantType[];
  responseTypes: ["code"];
  scopes: string[];
} {
  const redirectUris = uniqueValues(request.redirect_uris);
  if (redirectUris.length !== request.redirect_uris.length) {
    throw invalidRegistrationRequest("Redirect URIs must be unique.");
  }
  for (const redirectUri of redirectUris) {
    validateRedirectUri(redirectUri);
  }

  const grantTypes = uniqueValues(request.grant_types);
  if (!grantTypes.includes(OAuthGrantTypes.AUTHORIZATION_CODE)) {
    throw invalidRegistrationRequest("OAuth client must support authorization_code grants.");
  }
  const responseTypes = uniqueValues(request.response_types);
  if (responseTypes.length !== 1 || responseTypes[0] !== "code") {
    throw invalidRegistrationRequest("OAuth client must use the code response type.");
  }

  const scopes = uniqueValues(request.scope.split(" ").filter((scope) => scope.length > 0));
  if (scopes.length === 0) {
    throw invalidRegistrationRequest("OAuth client must request at least one scope.");
  }
  for (const scope of scopes) {
    if (!McpOAuthScopeSet.has(scope)) {
      throw invalidRegistrationRequest(`OAuth scope '${scope}' is not supported for MCP clients.`);
    }
  }

  return {
    clientName: request.client_name,
    redirectUris,
    grantTypes,
    responseTypes: ["code"],
    scopes,
  };
}

function validateRedirectUri(redirectUri: string): void {
  const url = new URL(redirectUri);
  if (url.hash.length > 0) {
    throw invalidRegistrationRequest("Redirect URI must not include a fragment.");
  }
  if (url.protocol === "https:") {
    return;
  }
  if (url.protocol !== "http:") {
    throw invalidRegistrationRequest("Redirect URI must use HTTPS or loopback HTTP.");
  }
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw invalidRegistrationRequest("HTTP redirect URI must use a loopback host.");
  }
  if (url.port.length === 0) {
    throw invalidRegistrationRequest("Loopback redirect URI must include a port.");
  }
}

function uniqueValues<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function invalidRegistrationRequest(message: string): BadRequestError {
  return new BadRequestError(OAuthErrorCodes.INVALID_REQUEST, message);
}
