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

import { OAuthTokenResponseSchema } from "../src/oauth/schemas.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

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
    expect(await detailsResponse.json()).toMatchObject({
      clientName: "Integration MCP Client",
      organizationName: "Integration MCP Consent Organization",
      resource: `${env.controlPlaneApi.hostBaseUrl}/mcp`,
      requestedScopes: ["sandboxProfile:read", "sandboxSession:create"],
    });
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
});

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
  const body = await response.json();
  if (typeof body !== "object" || body === null) {
    throw new Error("Expected client registration response.");
  }
  const clientId = Object.fromEntries(Object.entries(body)).client_id;
  if (typeof clientId !== "string") {
    throw new Error("Expected client id.");
  }

  return { clientId, redirectUri };
}

function buildAuthorizePath(input: {
  clientId: string;
  redirectUri: string;
  resource: string;
  state: string;
  scope: string;
  codeChallenge: string;
}): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    resource: input.resource,
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
    scope: input.scope,
  });
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
