/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { createHash, randomUUID } from "node:crypto";

import {
  OAuthApplicationTypes,
  OAuthClientRegistrationKinds,
  OAuthClientTypes,
} from "@mistle/db/control-plane";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import { and, eq } from "drizzle-orm";
import { describe, expect } from "vitest";

import { OrganizationPermissions } from "../src/auth/services/organization-policy.js";
import { CurrentActorResponseSchema } from "../src/me/get-current-actor/schema.js";
import { OAuthTokenResponseSchema } from "../src/oauth/schemas.js";
import {
  authenticateOAuthAccessToken,
  refreshOAuthTokenPair,
} from "../src/oauth/services/oauth-token.js";
import { ListSandboxInstancesResponseSchema } from "../src/sandbox-instances/index.js";

const it = createIntegrationTest({
  services: ["control-plane-api", "data-plane-api"],
});

describe.concurrent("OAuth CLI login integration", () => {
  it("redirects unauthenticated browser authorization requests to dashboard login", async ({
    env,
  }) => {
    const redirectUri = "http://127.0.0.1:61740/callback";
    const authorizePath = buildAuthorizePath({
      redirectUri,
      state: "unauthenticated-state",
      codeChallenge: pkceChallenge("unauthenticated-verifier-unauthenticated-verifier"),
    });

    const authorizeResponse = await env.controlPlaneApi.http.fetch(authorizePath, {
      redirect: "manual",
    });

    expect(authorizeResponse.status).toBe(302);
    const location = authorizeResponse.headers.get("location");
    expect(location).not.toBeNull();
    if (location === null) {
      throw new Error("Expected OAuth authorize login redirect location.");
    }
    const loginUrl = new URL(location);
    expect(loginUrl.pathname).toBe("/auth/login");
    const redirectTo = loginUrl.searchParams.get("redirectTo");
    expect(redirectTo).not.toBeNull();
    if (redirectTo === null) {
      throw new Error("Expected OAuth login redirectTo parameter.");
    }
    expect(new URL(redirectTo).pathname).toBe("/oauth/authorize");
  });

  it("exchanges a browser authorization code for OAuth tokens", async ({ env }) => {
    const session = await env.auth.createSession({
      email: `integration-oauth-cli-login-${randomUUID()}@example.com`,
    });
    const redirectUri = "http://127.0.0.1:61741/callback";
    const codeVerifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const state = "integration-state";

    const authorizeResponse = await env.controlPlaneApi.http.fetch(
      buildAuthorizePath({
        redirectUri,
        state,
        codeChallenge: pkceChallenge(codeVerifier),
      }),
      {
        headers: {
          cookie: session.cookie,
        },
        redirect: "manual",
      },
    );

    if (authorizeResponse.status !== 302) {
      throw new Error(await authorizeResponse.text());
    }
    expect(authorizeResponse.status).toBe(302);
    const location = authorizeResponse.headers.get("location");
    expect(location).not.toBeNull();
    if (location === null) {
      throw new Error("Expected OAuth authorize redirect location.");
    }
    const callbackUrl = new URL(location);
    expect(callbackUrl.origin).toBe("http://127.0.0.1:61741");
    expect(callbackUrl.pathname).toBe("/callback");
    expect(callbackUrl.searchParams.get("state")).toBe(state);
    const code = callbackUrl.searchParams.get("code");
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
        client_id: "mistle-cli",
        redirect_uri: redirectUri,
        code,
        code_verifier: codeVerifier,
      }),
    });

    expect(tokenResponse.status).toBe(200);
    const tokenBody = OAuthTokenResponseSchema.parse(await tokenResponse.json());
    expect(tokenBody.token_type).toBe("Bearer");
    expect(tokenBody.access_token).toMatch(/^mstl_oat_[A-Za-z0-9_-]+$/u);
    expect(tokenBody.refresh_token).toMatch(/^mstl_ort_[A-Za-z0-9_-]+$/u);
    expect(tokenBody.expires_in).toBe(3600);
    expect(tokenBody.scope).toBe(
      [
        OrganizationPermissions.ORGANIZATION_READ,
        OrganizationPermissions.SANDBOX_PROFILE_READ,
        OrganizationPermissions.SANDBOX_PROFILE_UPDATE,
        OrganizationPermissions.SANDBOX_SESSION_CREATE,
        OrganizationPermissions.SANDBOX_SESSION_READ,
        OrganizationPermissions.SANDBOX_SESSION_RESUME,
        OrganizationPermissions.SANDBOX_SESSION_CONNECT,
      ].join(" "),
    );

    const currentActorResponse = await env.controlPlaneApi.http.fetch("/v1/me", {
      headers: {
        authorization: `Bearer ${tokenBody.access_token}`,
      },
    });
    expect(currentActorResponse.status).toBe(200);
    const currentActor = CurrentActorResponseSchema.parse(await currentActorResponse.json());
    expect(currentActor.authentication.kind).toBe("oauth");
    expect(currentActor.actor).toStrictEqual({ kind: "user", id: session.userId });
    expect(currentActor.organization.id).toBe(session.organizationId);
    expect(currentActor.permissions).toStrictEqual([
      OrganizationPermissions.ORGANIZATION_READ,
      OrganizationPermissions.SANDBOX_PROFILE_READ,
      OrganizationPermissions.SANDBOX_PROFILE_UPDATE,
      OrganizationPermissions.SANDBOX_SESSION_CREATE,
      OrganizationPermissions.SANDBOX_SESSION_READ,
      OrganizationPermissions.SANDBOX_SESSION_RESUME,
      OrganizationPermissions.SANDBOX_SESSION_CONNECT,
    ]);

    const sandboxInstancesResponse = await env.controlPlaneApi.http.fetch("/v1/sandbox/instances", {
      headers: {
        authorization: `Bearer ${tokenBody.access_token}`,
      },
    });
    expect(sandboxInstancesResponse.status).toBe(200);
    const sandboxInstances = ListSandboxInstancesResponseSchema.parse(
      await sandboxInstancesResponse.json(),
    );
    expect(sandboxInstances.items).toStrictEqual([]);
    expect(sandboxInstances.totalResults).toBe(0);

    const repeatedTokenResponse = await env.controlPlaneApi.http.fetch("/oauth/token", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: "mistle-cli",
        redirect_uri: redirectUri,
        code,
        code_verifier: codeVerifier,
      }),
    });
    expect(repeatedTokenResponse.status).toBe(400);
    expect(await repeatedTokenResponse.json()).toStrictEqual({
      error: "invalid_grant",
      error_description: "Authorization code has already been used.",
    });

    const refreshTokenResponse = await env.controlPlaneApi.http.fetch("/oauth/token", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: "mistle-cli",
        refresh_token: tokenBody.refresh_token,
      }),
    });
    expect(refreshTokenResponse.status).toBe(200);
    const refreshedTokenBody = OAuthTokenResponseSchema.parse(await refreshTokenResponse.json());
    expect(refreshedTokenBody.access_token).toMatch(/^mstl_oat_[A-Za-z0-9_-]+$/u);
    expect(refreshedTokenBody.refresh_token).toBe(tokenBody.refresh_token);

    const mistleCliClient = await env.controlPlaneDb.query.oauthClients.findFirst({
      columns: {
        id: true,
      },
      where: (table, { eq }) => eq(table.clientId, "mistle-cli"),
    });
    if (mistleCliClient === undefined) {
      throw new Error("Expected Mistle CLI OAuth client to exist.");
    }
    await env.controlPlaneDb
      .delete(env.controlPlaneTables.oauthClientScopes)
      .where(
        and(
          eq(env.controlPlaneTables.oauthClientScopes.oauthClientId, mistleCliClient.id),
          eq(
            env.controlPlaneTables.oauthClientScopes.scope,
            OrganizationPermissions.SANDBOX_SESSION_CONNECT,
          ),
        ),
      );

    const remainingClientScopes = await env.controlPlaneDb.query.oauthClientScopes.findMany({
      columns: {
        scope: true,
      },
      where: (table, { eq }) => eq(table.oauthClientId, mistleCliClient.id),
    });
    expect(remainingClientScopes.map((scope) => scope.scope)).not.toContain(
      OrganizationPermissions.SANDBOX_SESSION_CONNECT,
    );

    const narrowedAuthContext = await authenticateOAuthAccessToken({
      db: env.controlPlaneDb,
      token: tokenBody.access_token,
    });
    expect(narrowedAuthContext.permissions).toStrictEqual([
      OrganizationPermissions.ORGANIZATION_READ,
      OrganizationPermissions.SANDBOX_PROFILE_READ,
      OrganizationPermissions.SANDBOX_PROFILE_UPDATE,
      OrganizationPermissions.SANDBOX_SESSION_CREATE,
      OrganizationPermissions.SANDBOX_SESSION_READ,
      OrganizationPermissions.SANDBOX_SESSION_RESUME,
    ]);

    const narrowedRefreshToken = await refreshOAuthTokenPair({
      db: env.controlPlaneDb,
      oauthClientId: mistleCliClient.id,
      refreshToken: tokenBody.refresh_token,
    });
    expect(narrowedRefreshToken.scope).toBe(
      [
        OrganizationPermissions.ORGANIZATION_READ,
        OrganizationPermissions.SANDBOX_PROFILE_READ,
        OrganizationPermissions.SANDBOX_PROFILE_UPDATE,
        OrganizationPermissions.SANDBOX_SESSION_CREATE,
        OrganizationPermissions.SANDBOX_SESSION_READ,
        OrganizationPermissions.SANDBOX_SESSION_RESUME,
      ].join(" "),
    );

    const otherClientId = `oac_test_${randomUUID()}`;
    await env.controlPlaneDb.insert(env.controlPlaneTables.oauthClients).values({
      id: otherClientId,
      clientId: `integration-oauth-client-${randomUUID()}`,
      name: "Other OAuth Client",
      clientType: OAuthClientTypes.PUBLIC,
      applicationType: OAuthApplicationTypes.NATIVE,
      registrationKind: OAuthClientRegistrationKinds.STATIC,
    });
    await env.controlPlaneDb
      .update(env.controlPlaneTables.oauthGrants)
      .set({
        oauthClientId: otherClientId,
      })
      .where(
        and(
          eq(env.controlPlaneTables.oauthGrants.userId, session.userId),
          eq(env.controlPlaneTables.oauthGrants.organizationId, session.organizationId),
        ),
      );

    const mismatchedClientRefreshResponse = await env.controlPlaneApi.http.fetch("/oauth/token", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: "mistle-cli",
        refresh_token: tokenBody.refresh_token,
      }),
    });
    expect(mismatchedClientRefreshResponse.status).toBe(400);
    expect(await mismatchedClientRefreshResponse.json()).toStrictEqual({
      error: "invalid_grant",
      error_description: "Refresh token client does not match.",
    });
  });

  it("rejects a mismatched PKCE verifier", async ({ env }) => {
    const session = await env.auth.createSession({
      email: `integration-oauth-cli-login-pkce-${randomUUID()}@example.com`,
    });
    const redirectUri = "http://127.0.0.1:61742/callback";

    const authorizeResponse = await env.controlPlaneApi.http.fetch(
      buildAuthorizePath({
        redirectUri,
        state: "pkce-state",
        codeChallenge: pkceChallenge("correct-verifier-correct-verifier-correct-verifier"),
      }),
      {
        headers: {
          cookie: session.cookie,
        },
        redirect: "manual",
      },
    );
    if (authorizeResponse.status !== 302) {
      throw new Error(await authorizeResponse.text());
    }
    expect(authorizeResponse.status).toBe(302);
    const location = authorizeResponse.headers.get("location");
    if (location === null) {
      throw new Error("Expected OAuth authorize redirect location.");
    }
    const code = new URL(location).searchParams.get("code");
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
        client_id: "mistle-cli",
        redirect_uri: redirectUri,
        code,
        code_verifier: "wrong-verifier-wrong-verifier-wrong-verifier",
      }),
    });

    expect(tokenResponse.status).toBe(400);
    expect(await tokenResponse.json()).toStrictEqual({
      error: "invalid_grant",
      error_description: "Authorization code verifier is invalid.",
    });
  });

  it("rejects OAuth access and refresh tokens after organization membership is revoked", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: `integration-oauth-cli-login-revoked-${randomUUID()}@example.com`,
    });
    const redirectUri = "http://127.0.0.1:61743/callback";
    const codeVerifier = "revoked-verifier-revoked-verifier-revoked-verifier";

    const authorizeResponse = await env.controlPlaneApi.http.fetch(
      buildAuthorizePath({
        redirectUri,
        state: "revoked-state",
        codeChallenge: pkceChallenge(codeVerifier),
      }),
      {
        headers: {
          cookie: session.cookie,
        },
        redirect: "manual",
      },
    );
    if (authorizeResponse.status !== 302) {
      throw new Error(await authorizeResponse.text());
    }
    const location = authorizeResponse.headers.get("location");
    if (location === null) {
      throw new Error("Expected OAuth authorize redirect location.");
    }
    const code = new URL(location).searchParams.get("code");
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
        client_id: "mistle-cli",
        redirect_uri: redirectUri,
        code,
        code_verifier: codeVerifier,
      }),
    });
    expect(tokenResponse.status).toBe(200);
    const tokenBody = OAuthTokenResponseSchema.parse(await tokenResponse.json());

    await env.controlPlaneDb
      .delete(env.controlPlaneTables.members)
      .where(
        and(
          eq(env.controlPlaneTables.members.organizationId, session.organizationId),
          eq(env.controlPlaneTables.members.userId, session.userId),
        ),
      );

    const currentActorResponse = await env.controlPlaneApi.http.fetch("/v1/me", {
      headers: {
        authorization: `Bearer ${tokenBody.access_token}`,
      },
    });
    expect(currentActorResponse.status).toBe(403);
    await expect(currentActorResponse.json()).resolves.toStrictEqual({
      code: "FORBIDDEN",
      message: "Forbidden API request.",
    });

    const refreshTokenResponse = await env.controlPlaneApi.http.fetch("/oauth/token", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: "mistle-cli",
        refresh_token: tokenBody.refresh_token,
      }),
    });
    expect(refreshTokenResponse.status).toBe(403);
    await expect(refreshTokenResponse.json()).resolves.toStrictEqual({
      code: "FORBIDDEN",
      message: "Forbidden API request.",
    });
  });
});

function buildAuthorizePath(input: {
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  return `/oauth/authorize?${new URLSearchParams({
    response_type: "code",
    client_id: "mistle-cli",
    redirect_uri: input.redirectUri,
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
  }).toString()}`;
}

function pkceChallenge(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier, "utf8").digest("base64url");
}
