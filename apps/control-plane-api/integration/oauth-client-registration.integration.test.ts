/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import {
  OAuthApplicationTypes,
  OAuthClientRegistrationKinds,
  OAuthClientTypes,
  OAuthGrantTypes,
} from "@mistle/db/control-plane";
import {
  type IntegrationTestEnvironment,
  createIntegrationTest,
} from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import { OAuthClientRegistrationResponseSchema } from "../src/oauth/schemas.js";
import { McpOAuthScopes } from "../src/oauth/well-known/protected-resource.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("OAuth dynamic client registration", () => {
  it("registers a dynamic public MCP client and persists its metadata", async ({ env }) => {
    const response = await registerClient(env, {
      client_name: "Integration MCP Client",
      redirect_uris: ["http://127.0.0.1:61750/callback", "https://client.example.test/oauth"],
      grant_types: [OAuthGrantTypes.AUTHORIZATION_CODE, OAuthGrantTypes.REFRESH_TOKEN],
      response_types: ["code"],
      scope: "sandboxProfile:read sandboxSession:create",
      token_endpoint_auth_method: "none",
    });

    expect(response.status).toBe(201);
    const registration = OAuthClientRegistrationResponseSchema.parse(await response.json());
    expect(registration.client_id).toMatch(/^oac_/);
    expect(registration.client_name).toBe("Integration MCP Client");
    expect(registration.redirect_uris).toStrictEqual([
      "http://127.0.0.1:61750/callback",
      "https://client.example.test/oauth",
    ]);
    expect(registration.grant_types).toStrictEqual([
      OAuthGrantTypes.AUTHORIZATION_CODE,
      OAuthGrantTypes.REFRESH_TOKEN,
    ]);
    expect(registration.response_types).toStrictEqual(["code"]);
    expect(registration.scope).toBe("sandboxProfile:read sandboxSession:create");
    expect(registration.token_endpoint_auth_method).toBe("none");

    const client = await env.controlPlaneDb.query.oauthClients.findFirst({
      where: (table, { eq }) => eq(table.clientId, registration.client_id),
    });
    expect(client).toMatchObject({
      clientId: registration.client_id,
      name: "Integration MCP Client",
      clientType: OAuthClientTypes.PUBLIC,
      applicationType: OAuthApplicationTypes.NATIVE,
      registrationKind: OAuthClientRegistrationKinds.DYNAMIC,
      clientSecretHash: null,
      clientSecretHashAlgorithm: null,
      disabledAt: null,
    });
    if (client === undefined) {
      throw new Error("Expected registered OAuth client.");
    }

    const redirectUris = await env.controlPlaneDb.query.oauthClientRedirectUris.findMany({
      columns: { redirectUri: true },
      where: (table, { eq }) => eq(table.oauthClientId, client.id),
    });
    expect(new Set(redirectUris.map((row) => row.redirectUri))).toStrictEqual(
      new Set(["http://127.0.0.1:61750/callback", "https://client.example.test/oauth"]),
    );

    const grantTypes = await env.controlPlaneDb.query.oauthClientGrantTypes.findMany({
      columns: { grantType: true },
      where: (table, { eq }) => eq(table.oauthClientId, client.id),
    });
    expect(new Set(grantTypes.map((row) => row.grantType))).toStrictEqual(
      new Set([OAuthGrantTypes.AUTHORIZATION_CODE, OAuthGrantTypes.REFRESH_TOKEN]),
    );

    const scopes = await env.controlPlaneDb.query.oauthClientScopes.findMany({
      columns: { scope: true },
      where: (table, { eq }) => eq(table.oauthClientId, client.id),
    });
    expect(new Set(scopes.map((row) => row.scope))).toStrictEqual(
      new Set(["sandboxProfile:read", "sandboxSession:create"]),
    );
  });

  it("rejects invalid redirect URIs", async ({ env }) => {
    for (const redirectUri of [
      "mistle://oauth/callback",
      "http://127.0.0.1/callback",
      "http://app.example.test/callback",
      "https://client.example.test/callback#fragment",
    ]) {
      const response = await registerClient(env, {
        client_name: `Invalid ${redirectUri}`,
        redirect_uris: [redirectUri],
        grant_types: [OAuthGrantTypes.AUTHORIZATION_CODE],
        response_types: ["code"],
        scope: "sandboxProfile:read",
        token_endpoint_auth_method: "none",
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: "invalid_request",
      });
    }
  });

  it("rejects unsupported grant types and confidential client metadata", async ({ env }) => {
    for (const body of [
      {
        client_name: "Unsupported Grant",
        redirect_uris: ["http://127.0.0.1:61751/callback"],
        grant_types: ["client_credentials"],
        response_types: ["code"],
        scope: "sandboxProfile:read",
        token_endpoint_auth_method: "none",
      },
      {
        client_name: "Confidential Client",
        redirect_uris: ["http://127.0.0.1:61752/callback"],
        grant_types: [OAuthGrantTypes.AUTHORIZATION_CODE],
        response_types: ["code"],
        scope: "sandboxProfile:read",
        token_endpoint_auth_method: "client_secret_basic",
      },
      {
        client_name: "Client Secret Field",
        redirect_uris: ["http://127.0.0.1:61753/callback"],
        grant_types: [OAuthGrantTypes.AUTHORIZATION_CODE],
        response_types: ["code"],
        scope: "sandboxProfile:read",
        token_endpoint_auth_method: "none",
        client_secret: "not-allowed",
      },
    ]) {
      const response = await registerClient(env, body);

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: "invalid_request",
      });
    }
  });

  it("rejects dynamic registration metadata that exceeds public endpoint limits", async ({
    env,
  }) => {
    for (const body of [
      {
        client_name: "a".repeat(121),
        redirect_uris: ["http://127.0.0.1:61755/callback"],
        grant_types: [OAuthGrantTypes.AUTHORIZATION_CODE],
        response_types: ["code"],
        scope: "sandboxProfile:read",
        token_endpoint_auth_method: "none",
      },
      {
        client_name: "Too Many Redirects",
        redirect_uris: Array.from(
          { length: 11 },
          (_, index) => `http://127.0.0.1:${61760 + index}/callback`,
        ),
        grant_types: [OAuthGrantTypes.AUTHORIZATION_CODE],
        response_types: ["code"],
        scope: "sandboxProfile:read",
        token_endpoint_auth_method: "none",
      },
      {
        client_name: "Duplicate Metadata",
        redirect_uris: ["http://127.0.0.1:61756/callback", "http://127.0.0.1:61756/callback"],
        grant_types: [OAuthGrantTypes.AUTHORIZATION_CODE, OAuthGrantTypes.AUTHORIZATION_CODE],
        response_types: ["code"],
        scope: "sandboxProfile:read sandboxProfile:read",
        token_endpoint_auth_method: "none",
      },
      {
        client_name: "Oversized Scope",
        redirect_uris: ["http://127.0.0.1:61757/callback"],
        grant_types: [OAuthGrantTypes.AUTHORIZATION_CODE],
        response_types: ["code"],
        scope: "sandboxProfile:read ".repeat(40).trim(),
        token_endpoint_auth_method: "none",
      },
    ]) {
      const response = await registerClient(env, body);

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: "invalid_request",
      });
    }
  });

  it("rejects dynamic client scopes outside the MCP scope set", async ({ env }) => {
    const response = await registerClient(env, {
      client_name: "Non-MCP Scope Client",
      redirect_uris: ["http://127.0.0.1:61754/callback"],
      grant_types: [OAuthGrantTypes.AUTHORIZATION_CODE],
      response_types: ["code"],
      scope: "organization:read",
      token_endpoint_auth_method: "none",
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "invalid_request",
    });
  });

  it("advertises the dynamic registration endpoint in authorization server metadata", async ({
    env,
  }) => {
    const response = await env.controlPlaneApi.http.fetch(
      "/.well-known/oauth-authorization-server",
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      registration_endpoint: `${env.controlPlaneApi.hostBaseUrl}/oauth/register`,
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["organization:read", ...McpOAuthScopes, "sandboxSession:resume"].sort(),
    });
  });
});

async function registerClient(env: IntegrationTestEnvironment, body: unknown) {
  return await env.controlPlaneApi.http.fetch("/oauth/register", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
