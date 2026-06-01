/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { createHash, randomUUID } from "node:crypto";

import { OAuthGrantTypes } from "@mistle/db/control-plane";
import {
  type IntegrationTestEnvironment,
  createIntegrationTest,
} from "@mistle/test-harness/integration";
import { and, eq } from "drizzle-orm";
import { describe, expect } from "vitest";
import { z } from "zod";

import { OrganizationPermissions } from "../src/auth/services/organization-policy.js";
import {
  OAuthClientRegistrationResponseSchema,
  OAuthTokenResponseSchema,
} from "../src/oauth/schemas.js";
import {
  createOAuthAuthorizationConsentRequest,
  getOAuthAuthorizationConsentDetails,
} from "../src/oauth/services/authorization-consent.js";
import { createOAuthGrantTokenPair } from "../src/oauth/services/oauth-token.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

const JsonRpcToolResponseSchema = z
  .object({
    jsonrpc: z.literal("2.0"),
    id: z.union([z.string(), z.number()]),
    result: z
      .object({
        content: z
          .array(
            z.object({
              type: z.literal("text"),
              text: z.string(),
            }),
          )
          .optional(),
        structuredContent: z.unknown().optional(),
        isError: z.boolean().optional(),
      })
      .loose(),
  })
  .strict();

describe.concurrent("OAuth MCP consent", () => {
  it("redirects valid unauthenticated MCP authorization requests to dashboard login", async ({
    env,
  }) => {
    const client = await registerMcpClient(env);
    const authorizePath = buildAuthorizePath({
      clientId: client.clientId,
      redirectUri: client.redirectUri,
      resource: `${env.controlPlaneApi.hostBaseUrl}/mcp`,
      state: "mcp-login-state",
      scope: "sandboxProfile:read",
      codeChallenge: pkceChallenge("mcp-login-verifier-mcp-login-verifier-mcp-login-verifier"),
    });

    const response = await env.controlPlaneApi.http.fetch(authorizePath, {
      redirect: "manual",
    });

    expect(response.status).toBe(302);
    const location = requireHeader(response, "location");
    const locationUrl = new URL(location);
    expect(locationUrl.pathname).toBe("/auth/login");
    expect(locationUrl.searchParams.get("redirectTo")).toBe(
      new URL(authorizePath, env.controlPlaneApi.hostBaseUrl).toString(),
    );
  });

  it("returns OAuth JSON errors for invalid unauthenticated authorization requests", async ({
    env,
  }) => {
    const response = await env.controlPlaneApi.http.fetch(
      buildAuthorizePath({
        clientId: "missing-client",
        redirectUri: "https://client.example.test/callback",
        resource: `${env.controlPlaneApi.hostBaseUrl}/mcp`,
        state: "invalid-client-state",
        scope: "sandboxProfile:read",
        codeChallenge: pkceChallenge("invalid-client-verifier-invalid-client-verifier"),
      }),
      {
        redirect: "manual",
      },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "unauthorized_client",
    });
  });

  it("returns OAuth JSON errors for invalid MCP authorization resources", async ({ env }) => {
    const client = await registerMcpClient(env);
    const response = await env.controlPlaneApi.http.fetch(
      buildAuthorizePath({
        clientId: client.clientId,
        redirectUri: client.redirectUri,
        resource: env.controlPlaneApi.hostBaseUrl,
        state: "invalid-resource-state",
        scope: "sandboxProfile:read",
        codeChallenge: pkceChallenge("invalid-resource-verifier-invalid-resource-verifier"),
      }),
      {
        redirect: "manual",
      },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toStrictEqual({
      error: "invalid_target",
      error_description: "OAuth resource is invalid.",
    });
  });

  it("redirects invalid unauthenticated scopes to the validated redirect URI", async ({ env }) => {
    const client = await registerMcpClient(env);
    const response = await env.controlPlaneApi.http.fetch(
      buildAuthorizePath({
        clientId: client.clientId,
        redirectUri: client.redirectUri,
        resource: `${env.controlPlaneApi.hostBaseUrl}/mcp`,
        state: "invalid-unauthenticated-scope-state",
        scope: "organization:read",
        codeChallenge: pkceChallenge(
          "invalid-unauthenticated-scope-verifier-invalid-unauthenticated-scope-verifier",
        ),
      }),
      {
        redirect: "manual",
      },
    );

    expect(response.status).toBe(302);
    const redirectUrl = new URL(requireHeader(response, "location"));
    expect(redirectUrl.origin).toBe("https://client.example.test");
    expect(redirectUrl.searchParams.get("error")).toBe("invalid_scope");
    expect(redirectUrl.searchParams.get("state")).toBe("invalid-unauthenticated-scope-state");
  });

  it("creates pending consent for authenticated MCP authorization requests", async ({ env }) => {
    const session = await env.auth.createSession({
      email: `integration-oauth-mcp-consent-${randomUUID()}@example.com`,
      organizationName: "Integration MCP Consent Organization",
    });
    const client = await registerMcpClient(env);
    const response = await env.controlPlaneApi.http.fetch(
      buildAuthorizePath({
        clientId: client.clientId,
        redirectUri: client.redirectUri,
        resource: `${env.controlPlaneApi.hostBaseUrl}/mcp`,
        state: "pending-consent-state",
        scope: "sandboxProfile:read sandboxSession:create",
        codeChallenge: pkceChallenge("pending-consent-verifier-pending-consent-verifier"),
      }),
      {
        headers: {
          cookie: session.cookie,
        },
        redirect: "manual",
      },
    );

    expect(response.status).toBe(302);
    const locationUrl = new URL(requireHeader(response, "location"));
    expect(locationUrl.pathname).toMatch(/^\/auth\/oauth\/consent\/.+/);

    const detailsResponse = await env.controlPlaneApi.http.fetch(
      `/oauth/consent/${locationUrl.pathname.split("/").at(-1)}`,
      {
        headers: {
          cookie: session.cookie,
        },
      },
    );
    expect(detailsResponse.status).toBe(200);
    const detailsBody = await detailsResponse.json();
    expect(detailsBody).toMatchObject({
      clientName: "Integration MCP Client",
      organizationName: "Integration MCP Consent Organization",
      resource: `${env.controlPlaneApi.hostBaseUrl}/mcp`,
      requestedScopes: ["sandboxProfile:read", "sandboxSession:create"],
    });
    const restartUrl = new URL(readStringProperty(detailsBody, "authorizationRestartUri"));
    expect(restartUrl.origin).toBe(new URL(env.controlPlaneApi.hostBaseUrl).origin);
    expect(restartUrl.pathname).toBe("/oauth/authorize");
    expect(restartUrl.searchParams.get("response_type")).toBe("code");
    expect(restartUrl.searchParams.get("client_id")).toBe(client.clientId);
    expect(restartUrl.searchParams.get("redirect_uri")).toBe(client.redirectUri);
    expect(restartUrl.searchParams.get("resource")).toBe(`${env.controlPlaneApi.hostBaseUrl}/mcp`);
    expect(restartUrl.searchParams.get("scope")).toBe("sandboxProfile:read sandboxSession:create");
    expect(restartUrl.searchParams.get("state")).toBe("pending-consent-state");
    expect(restartUrl.searchParams.get("code_challenge")).toBe(
      pkceChallenge("pending-consent-verifier-pending-consent-verifier"),
    );
    expect(restartUrl.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("builds restart URIs from the original requested scopes and preserves auth path prefixes", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: `integration-oauth-mcp-consent-restart-${randomUUID()}@example.com`,
      organizationName: "Integration MCP Restart Organization",
    });
    const requestId = await createOAuthAuthorizationConsentRequest({
      db: env.controlPlaneDb,
      clientId: "restart-uri-client",
      clientName: "Restart URI Client",
      redirectUri: "https://client.example.test/restart-callback",
      resource: `${env.controlPlaneApi.hostBaseUrl}/mcp`,
      codeChallenge: pkceChallenge("restart-uri-verifier-restart-uri-verifier"),
      state: "restart-uri-state",
      userId: session.userId,
      organizationId: session.organizationId,
      requestedScopes: [OrganizationPermissions.SANDBOX_PROFILE_READ],
      authorizationRequestedScopes: [
        OrganizationPermissions.SANDBOX_PROFILE_READ,
        OrganizationPermissions.SANDBOX_SESSION_CREATE,
      ],
    });

    const details = await getOAuthAuthorizationConsentDetails({
      db: env.controlPlaneDb,
      requestId,
      userId: session.userId,
      organizationId: session.organizationId,
      authBaseUrl: "https://auth.example.test/base",
    });

    expect(details.requestedScopes).toStrictEqual([OrganizationPermissions.SANDBOX_PROFILE_READ]);
    const restartUrl = new URL(details.authorizationRestartUri);
    expect(restartUrl.origin).toBe("https://auth.example.test");
    expect(restartUrl.pathname).toBe("/base/oauth/authorize");
    expect(restartUrl.searchParams.get("scope")).toBe("sandboxProfile:read sandboxSession:create");
    expect(restartUrl.searchParams.get("state")).toBe("restart-uri-state");
  });

  it("approves selected scopes and preserves state in the client redirect", async ({ env }) => {
    const session = await env.auth.createSession({
      email: `integration-oauth-mcp-consent-approve-${randomUUID()}@example.com`,
    });
    const requestId = await createPendingConsentRequest({
      env,
      sessionCookie: session.cookie,
      state: "approved-state",
    });

    const approveResponse = await env.controlPlaneApi.http.fetch(
      `/oauth/consent/${requestId}/approve`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
        },
        body: JSON.stringify({
          scopes: ["sandboxProfile:read"],
        }),
      },
    );

    expect(approveResponse.status).toBe(200);
    const redirectUri = readRedirectUri(await approveResponse.json());
    const redirectUrl = new URL(redirectUri);
    expect(redirectUrl.origin).toBe("https://client.example.test");
    expect(redirectUrl.searchParams.get("state")).toBe("approved-state");
    const code = redirectUrl.searchParams.get("code");
    expect(code).toBeTruthy();
    if (code === null) {
      throw new Error("Expected OAuth callback code.");
    }
    const tokenResponse = await env.controlPlaneApi.http.fetch("/oauth/token", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: "unused",
        redirect_uri: "unused",
        resource: `${env.controlPlaneApi.hostBaseUrl}/mcp`,
        code,
        code_verifier: "unused",
      }),
    });
    expect(tokenResponse.status).toBe(400);
  });

  it("exchanges an approved subset of scopes and consumes the consent request", async ({ env }) => {
    const session = await env.auth.createSession({
      email: `integration-oauth-mcp-consent-subset-${randomUUID()}@example.com`,
    });
    const pendingConsent = await createPendingConsentRequestDetails({
      env,
      sessionCookie: session.cookie,
      state: "approved-subset-state",
    });

    const approveResponse = await env.controlPlaneApi.http.fetch(
      `/oauth/consent/${pendingConsent.requestId}/approve`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
        },
        body: JSON.stringify({
          scopes: ["sandboxProfile:read"],
        }),
      },
    );
    expect(approveResponse.status).toBe(200);
    const redirectUrl = new URL(readRedirectUri(await approveResponse.json()));
    const code = redirectUrl.searchParams.get("code");
    if (code === null) {
      throw new Error("Expected OAuth callback code.");
    }

    const tokenResponse = await env.controlPlaneApi.http.fetch("/oauth/token", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: pendingConsent.clientId,
        redirect_uri: pendingConsent.redirectUri,
        resource: `${env.controlPlaneApi.hostBaseUrl}/mcp`,
        code,
        code_verifier: pendingConsent.codeVerifier,
      }),
    });
    expect(tokenResponse.status).toBe(200);
    const tokenBody = OAuthTokenResponseSchema.parse(await tokenResponse.json());
    expect(tokenBody.scope).toBe("sandboxProfile:read");

    const repeatedApproveResponse = await env.controlPlaneApi.http.fetch(
      `/oauth/consent/${pendingConsent.requestId}/approve`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
        },
        body: JSON.stringify({
          scopes: ["sandboxProfile:read"],
        }),
      },
    );
    expect(repeatedApproveResponse.status).toBe(404);
  });

  it("rejects consent access from another active organization", async ({ env }) => {
    const ownerSession = await env.auth.createSession({
      email: `integration-oauth-mcp-consent-owner-${randomUUID()}@example.com`,
    });
    const otherSession = await env.auth.createSession({
      email: `integration-oauth-mcp-consent-other-${randomUUID()}@example.com`,
    });
    const requestId = await createPendingConsentRequest({
      env,
      sessionCookie: ownerSession.cookie,
      state: "wrong-org-state",
    });

    const detailsResponse = await env.controlPlaneApi.http.fetch(`/oauth/consent/${requestId}`, {
      headers: {
        cookie: otherSession.cookie,
      },
    });
    expect(detailsResponse.status).toBe(403);

    const denyResponse = await env.controlPlaneApi.http.fetch(`/oauth/consent/${requestId}/deny`, {
      method: "POST",
      headers: {
        cookie: otherSession.cookie,
      },
    });
    expect(denyResponse.status).toBe(403);
  });

  it("revalidates current client scopes before consuming consent approval", async ({ env }) => {
    const session = await env.auth.createSession({
      email: `integration-oauth-mcp-consent-revalidate-${randomUUID()}@example.com`,
    });
    const pendingConsent = await createPendingConsentRequestDetails({
      env,
      sessionCookie: session.cookie,
      state: "revalidate-state",
    });
    const client = await env.controlPlaneDb.query.oauthClients.findFirst({
      columns: {
        id: true,
      },
      where: (table, { eq }) => eq(table.clientId, pendingConsent.clientId),
    });
    if (client === undefined) {
      throw new Error("Expected registered OAuth client.");
    }
    await env.controlPlaneDb
      .delete(env.controlPlaneTables.oauthClientScopes)
      .where(
        and(
          eq(env.controlPlaneTables.oauthClientScopes.oauthClientId, client.id),
          eq(env.controlPlaneTables.oauthClientScopes.scope, "sandboxSession:create"),
        ),
      );

    const staleApproveResponse = await env.controlPlaneApi.http.fetch(
      `/oauth/consent/${pendingConsent.requestId}/approve`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
        },
        body: JSON.stringify({
          scopes: ["sandboxProfile:read", "sandboxSession:create"],
        }),
      },
    );
    expect(staleApproveResponse.status).toBe(400);
    expect(await staleApproveResponse.json()).toMatchObject({
      error: "invalid_scope",
    });

    const currentApproveResponse = await env.controlPlaneApi.http.fetch(
      `/oauth/consent/${pendingConsent.requestId}/approve`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
        },
        body: JSON.stringify({
          scopes: ["sandboxProfile:read"],
        }),
      },
    );
    expect(currentApproveResponse.status).toBe(200);
  });

  it("denies consent with access_denied and preserves state", async ({ env }) => {
    const session = await env.auth.createSession({
      email: `integration-oauth-mcp-consent-deny-${randomUUID()}@example.com`,
    });
    const requestId = await createPendingConsentRequest({
      env,
      sessionCookie: session.cookie,
      state: "denied-state",
    });

    const denyResponse = await env.controlPlaneApi.http.fetch(`/oauth/consent/${requestId}/deny`, {
      method: "POST",
      headers: {
        cookie: session.cookie,
      },
    });

    expect(denyResponse.status).toBe(200);
    const redirectUrl = new URL(readRedirectUri(await denyResponse.json()));
    expect(redirectUrl.searchParams.get("error")).toBe("access_denied");
    expect(redirectUrl.searchParams.get("state")).toBe("denied-state");
  });

  it("redirects invalid scope errors to the validated redirect URI", async ({ env }) => {
    const session = await env.auth.createSession({
      email: `integration-oauth-mcp-consent-invalid-scope-${randomUUID()}@example.com`,
    });
    const client = await registerMcpClient(env);
    const response = await env.controlPlaneApi.http.fetch(
      buildAuthorizePath({
        clientId: client.clientId,
        redirectUri: client.redirectUri,
        resource: `${env.controlPlaneApi.hostBaseUrl}/mcp`,
        state: "invalid-scope-state",
        scope: "organization:read",
        codeChallenge: pkceChallenge("invalid-scope-verifier-invalid-scope-verifier"),
      }),
      {
        headers: {
          cookie: session.cookie,
        },
        redirect: "manual",
      },
    );

    expect(response.status).toBe(302);
    const redirectUrl = new URL(requireHeader(response, "location"));
    expect(redirectUrl.origin).toBe("https://client.example.test");
    expect(redirectUrl.searchParams.get("error")).toBe("invalid_scope");
    expect(redirectUrl.searchParams.get("state")).toBe("invalid-scope-state");
  });

  it("exchanges an approved dynamic-client authorization code and calls MCP with the bearer token", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: `integration-oauth-mcp-bearer-${randomUUID()}@example.com`,
    });
    const tokenBody = await authorizeApproveAndExchangeMcpToken({
      env,
      sessionCookie: session.cookie,
      scope: "sandboxProfile:read",
      state: "mcp-bearer-state",
    });

    const result = await callMcpTool({
      env,
      token: tokenBody.access_token,
      name: "profile_list",
      arguments: {
        limit: 10,
      },
    });

    expect(result.isError).toBeUndefined();
    expect(tokenBody.refresh_token).toMatch(/^mstl_ort_[A-Za-z0-9_-]+$/u);
  });

  it("defaults omitted dynamic-client OAuth resources to the configured MCP resource", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: `integration-oauth-mcp-default-resource-${randomUUID()}@example.com`,
    });
    const client = await registerMcpClient(env);
    const codeVerifier = "default-resource-verifier-default-resource-verifier";
    const authorizeResponse = await env.controlPlaneApi.http.fetch(
      buildAuthorizePath({
        clientId: client.clientId,
        redirectUri: client.redirectUri,
        state: "default-resource-state",
        scope: "sandboxProfile:read",
        codeChallenge: pkceChallenge(codeVerifier),
      }),
      {
        headers: {
          cookie: session.cookie,
        },
        redirect: "manual",
      },
    );
    expect(authorizeResponse.status).toBe(302);
    const consentRequestId =
      new URL(requireHeader(authorizeResponse, "location")).pathname.split("/").at(-1) ?? "";

    const detailsResponse = await env.controlPlaneApi.http.fetch(
      `/oauth/consent/${consentRequestId}`,
      {
        headers: {
          cookie: session.cookie,
        },
      },
    );
    expect(detailsResponse.status).toBe(200);
    const detailsBody = await detailsResponse.json();
    expect(detailsBody).toMatchObject({
      resource: `${env.controlPlaneApi.hostBaseUrl}/mcp`,
    });

    const approveResponse = await env.controlPlaneApi.http.fetch(
      `/oauth/consent/${consentRequestId}/approve`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
        },
        body: JSON.stringify({
          scopes: ["sandboxProfile:read"],
        }),
      },
    );
    expect(approveResponse.status).toBe(200);
    const redirectUri = readRedirectUri(await approveResponse.json());
    const code = new URL(redirectUri).searchParams.get("code");
    if (code === null) {
      throw new Error("Expected OAuth callback code.");
    }

    const tokenResponse = await env.controlPlaneApi.http.fetch("/oauth/token", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: client.clientId,
        redirect_uri: client.redirectUri,
        code,
        code_verifier: codeVerifier,
      }),
    });
    expect(tokenResponse.status).toBe(200);
    const tokenBody = OAuthTokenResponseSchema.parse(await tokenResponse.json());

    const result = await callMcpTool({
      env,
      token: tokenBody.access_token,
      name: "profile_list",
      arguments: {
        limit: 10,
      },
    });

    expect(result.isError).toBeUndefined();

    const refreshResponse = await env.controlPlaneApi.http.fetch("/oauth/token", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: client.clientId,
        refresh_token: tokenBody.refresh_token,
      }),
    });
    expect(refreshResponse.status).toBe(200);
    const refreshedTokenBody = OAuthTokenResponseSchema.parse(await refreshResponse.json());

    const refreshedResult = await callMcpTool({
      env,
      token: refreshedTokenBody.access_token,
      name: "profile_list",
      arguments: {
        limit: 10,
      },
    });

    expect(refreshedResult.isError).toBeUndefined();
  });

  it("rejects OAuth bearer tokens issued for non-MCP resources on the MCP endpoint", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: `integration-oauth-mcp-wrong-resource-${randomUUID()}@example.com`,
    });
    const client = await env.controlPlaneDb.query.oauthClients.findFirst({
      columns: {
        id: true,
      },
      where: (table, { eq }) => eq(table.clientId, "mistle-cli"),
    });
    if (client === undefined) {
      throw new Error("Expected Mistle CLI OAuth client.");
    }
    const tokenPair = await createOAuthGrantTokenPair({
      db: env.controlPlaneDb,
      oauthClientId: client.id,
      userId: session.userId,
      organizationId: session.organizationId,
      resource: env.controlPlaneApi.hostBaseUrl,
      permissions: [OrganizationPermissions.SANDBOX_PROFILE_READ],
    });

    const response = await fetchMcpTool({
      env,
      token: tokenPair.accessToken,
      name: "profile_list",
      arguments: {
        limit: 10,
      },
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain('error="invalid_token"');
  });

  it("returns an invalid-token challenge when an MCP OAuth token loses organization access", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: `integration-oauth-mcp-revoked-member-${randomUUID()}@example.com`,
    });
    const client = await env.controlPlaneDb.query.oauthClients.findFirst({
      columns: {
        id: true,
      },
      where: (table, { eq }) => eq(table.clientId, "mistle-cli"),
    });
    if (client === undefined) {
      throw new Error("Expected Mistle CLI OAuth client.");
    }
    const tokenPair = await createOAuthGrantTokenPair({
      db: env.controlPlaneDb,
      oauthClientId: client.id,
      userId: session.userId,
      organizationId: session.organizationId,
      resource: `${env.controlPlaneApi.hostBaseUrl}/mcp`,
      permissions: [OrganizationPermissions.SANDBOX_PROFILE_READ],
    });
    await env.controlPlaneDb
      .delete(env.controlPlaneTables.members)
      .where(
        and(
          eq(env.controlPlaneTables.members.organizationId, session.organizationId),
          eq(env.controlPlaneTables.members.userId, session.userId),
        ),
      );

    const response = await fetchMcpTool({
      env,
      token: tokenPair.accessToken,
      name: "profile_list",
      arguments: {
        limit: 10,
      },
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain('error="invalid_token"');
  });

  it("returns a JSON-RPC tool error when an MCP OAuth token lacks the required scope", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: `integration-oauth-mcp-missing-scope-${randomUUID()}@example.com`,
    });
    const client = await env.controlPlaneDb.query.oauthClients.findFirst({
      columns: {
        id: true,
      },
      where: (table, { eq }) => eq(table.clientId, "mistle-cli"),
    });
    if (client === undefined) {
      throw new Error("Expected Mistle CLI OAuth client.");
    }
    const tokenPair = await createOAuthGrantTokenPair({
      db: env.controlPlaneDb,
      oauthClientId: client.id,
      userId: session.userId,
      organizationId: session.organizationId,
      resource: `${env.controlPlaneApi.hostBaseUrl}/mcp`,
      permissions: [OrganizationPermissions.SANDBOX_SESSION_READ],
    });

    const result = await callMcpTool({
      env,
      token: tokenPair.accessToken,
      name: "profile_list",
      arguments: {},
    });

    expect(result.isError).toBe(true);
    expect(result.content?.map((item) => item.text).join("\n")).toContain(
      "Missing required MCP permission: sandboxProfile:read.",
    );
  });
});

async function authorizeApproveAndExchangeMcpToken(input: {
  env: IntegrationTestEnvironment;
  sessionCookie: string;
  scope: string;
  state: string;
}) {
  const client = await registerMcpClient(input.env);
  const codeVerifier = `${input.state}-verifier-${input.state}-verifier-${input.state}`;
  const authorizeResponse = await input.env.controlPlaneApi.http.fetch(
    buildAuthorizePath({
      clientId: client.clientId,
      redirectUri: client.redirectUri,
      resource: `${input.env.controlPlaneApi.hostBaseUrl}/mcp`,
      state: input.state,
      scope: input.scope,
      codeChallenge: pkceChallenge(codeVerifier),
    }),
    {
      headers: {
        cookie: input.sessionCookie,
      },
      redirect: "manual",
    },
  );
  expect(authorizeResponse.status).toBe(302);
  const consentRequestId =
    new URL(requireHeader(authorizeResponse, "location")).pathname.split("/").at(-1) ?? "";

  const approveResponse = await input.env.controlPlaneApi.http.fetch(
    `/oauth/consent/${consentRequestId}/approve`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: input.sessionCookie,
      },
      body: JSON.stringify({
        scopes: input.scope.split(" "),
      }),
    },
  );
  expect(approveResponse.status).toBe(200);
  const redirectUri = readRedirectUri(await approveResponse.json());
  const code = new URL(redirectUri).searchParams.get("code");
  if (code === null) {
    throw new Error("Expected OAuth callback code.");
  }

  const tokenResponse = await input.env.controlPlaneApi.http.fetch("/oauth/token", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: client.clientId,
      redirect_uri: client.redirectUri,
      resource: `${input.env.controlPlaneApi.hostBaseUrl}/mcp`,
      code,
      code_verifier: codeVerifier,
    }),
  });
  expect(tokenResponse.status).toBe(200);

  return OAuthTokenResponseSchema.parse(await tokenResponse.json());
}

async function createPendingConsentRequest(input: {
  env: IntegrationTestEnvironment;
  sessionCookie: string;
  state: string;
}): Promise<string> {
  return (
    await createPendingConsentRequestDetails({
      env: input.env,
      sessionCookie: input.sessionCookie,
      state: input.state,
    })
  ).requestId;
}

async function createPendingConsentRequestDetails(input: {
  env: IntegrationTestEnvironment;
  sessionCookie: string;
  state: string;
}): Promise<{
  requestId: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
}> {
  const client = await registerMcpClient(input.env);
  const codeVerifier = `${input.state}-verifier-${input.state}-verifier`;
  const response = await input.env.controlPlaneApi.http.fetch(
    buildAuthorizePath({
      clientId: client.clientId,
      redirectUri: client.redirectUri,
      resource: `${input.env.controlPlaneApi.hostBaseUrl}/mcp`,
      state: input.state,
      scope: "sandboxProfile:read sandboxSession:create",
      codeChallenge: pkceChallenge(codeVerifier),
    }),
    {
      headers: {
        cookie: input.sessionCookie,
      },
      redirect: "manual",
    },
  );
  expect(response.status).toBe(302);

  return {
    requestId: new URL(requireHeader(response, "location")).pathname.split("/").at(-1) ?? "",
    clientId: client.clientId,
    redirectUri: client.redirectUri,
    codeVerifier,
  };
}

async function registerMcpClient(
  env: IntegrationTestEnvironment,
): Promise<{ clientId: string; redirectUri: string }> {
  const redirectUri = "https://client.example.test/callback";
  const response = await env.controlPlaneApi.http.fetch("/oauth/register", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      client_name: "Integration MCP Client",
      redirect_uris: [redirectUri],
      grant_types: [OAuthGrantTypes.AUTHORIZATION_CODE, OAuthGrantTypes.REFRESH_TOKEN],
      response_types: ["code"],
      scope: "sandboxProfile:read sandboxSession:create",
      token_endpoint_auth_method: "none",
    }),
  });
  expect(response.status).toBe(201);
  const body = OAuthClientRegistrationResponseSchema.parse(await response.json());

  return { clientId: body.client_id, redirectUri };
}

function buildAuthorizePath(input: {
  clientId: string;
  redirectUri: string;
  resource?: string;
  state: string;
  scope: string;
  codeChallenge: string;
}): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
    scope: input.scope,
  });
  if (input.resource !== undefined) {
    params.set("resource", input.resource);
  }
  return `/oauth/authorize?${params.toString()}`;
}

function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function requireHeader(response: { headers: { get(name: string): string | null } }, name: string) {
  const value = response.headers.get(name);
  if (value === null) {
    throw new Error(`Expected ${name} header.`);
  }

  return value;
}

async function callMcpTool(input: {
  env: IntegrationTestEnvironment;
  token: string;
  name: string;
  arguments: Record<string, unknown>;
}): Promise<z.infer<typeof JsonRpcToolResponseSchema>["result"]> {
  const response = await fetchMcpTool(input);

  expect(response.status).toBe(200);
  const message = parseStreamableHttpJsonRpcMessage(await response.text());
  return JsonRpcToolResponseSchema.parse(message).result;
}

async function fetchMcpTool(input: {
  env: IntegrationTestEnvironment;
  token: string;
  name: string;
  arguments: Record<string, unknown>;
}) {
  return await input.env.controlPlaneApi.http.fetch("/mcp", {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${input.token}`,
      "content-type": "application/json",
      forwarded: createForwardedHeaderForBaseUrl(input.env.controlPlaneApi.hostBaseUrl),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "mcp-test",
      method: "tools/call",
      params: {
        name: input.name,
        arguments: input.arguments,
      },
    }),
  });
}

function createForwardedHeaderForBaseUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  return `proto=${url.protocol.slice(0, -1)};host=${url.host}`;
}

function parseStreamableHttpJsonRpcMessage(responseBody: string): unknown {
  const dataLine = responseBody.split("\n").find((line) => line.startsWith("data: "));

  if (dataLine === undefined) {
    throw new Error("Expected MCP streamable HTTP response to contain a data line.");
  }

  return JSON.parse(dataLine.slice("data: ".length));
}

function readRedirectUri(value: unknown): string {
  if (typeof value !== "object" || value === null) {
    throw new Error("Expected redirect response.");
  }
  const redirectUri = Object.fromEntries(Object.entries(value)).redirectUri;
  if (typeof redirectUri !== "string") {
    throw new Error("Expected redirect URI.");
  }

  return redirectUri;
}

function readStringProperty(value: unknown, key: string): string {
  if (typeof value !== "object" || value === null) {
    throw new Error("Expected object response.");
  }
  const property = Object.fromEntries(Object.entries(value))[key];
  if (typeof property !== "string") {
    throw new Error(`Expected ${key} to be a string.`);
  }

  return property;
}
