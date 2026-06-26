import {
  IntegrationOAuth2AuthorizationCodeRefreshAccessTokenError,
  IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications,
} from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { XeroOAuthScopes } from "./auth.js";
import {
  buildXeroAuthorizationCodeExchangeRequestBody,
  buildXeroAuthorizationUrl,
  buildXeroBasicAuthorizationHeader,
  buildXeroRefreshRequestBody,
  classifyXeroRefreshFailure,
  createXeroRefreshTransportFailure,
  resolveXeroAccessTokenExpiresAt,
  resolveXeroAuthorizationCodeOrThrow,
  resolveXeroCompleteGrantResult,
  resolveXeroRefreshResult,
  XeroMcpOAuth2AuthorizationCodeCapability,
} from "./oauth2-authorization-code.server.js";

describe("Xero OAuth authorization code support", () => {
  it("builds a Xero authorization URL with the configured scopes", () => {
    const authorizationUrl = new URL(
      buildXeroAuthorizationUrl({
        clientId: "xero_client_123",
        redirectUrl: "https://mistle.example.com/oauth/callback",
        state: "state_abc",
        pkceChallenge: "challenge_456",
        scopes: XeroOAuthScopes,
      }),
    );

    expect(authorizationUrl.origin).toBe("https://login.xero.com");
    expect(authorizationUrl.pathname).toBe("/identity/connect/authorize");
    expect(authorizationUrl.searchParams.get("response_type")).toBe("code");
    expect(authorizationUrl.searchParams.get("client_id")).toBe("xero_client_123");
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(
      "https://mistle.example.com/oauth/callback",
    );
    expect(authorizationUrl.searchParams.get("state")).toBe("state_abc");
    expect(authorizationUrl.searchParams.get("scope")).toBe(XeroOAuthScopes.join(" "));
    expect(authorizationUrl.searchParams.get("code_challenge")).toBe("challenge_456");
    expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("builds Xero token exchange and refresh request bodies", () => {
    expect(
      buildXeroAuthorizationCodeExchangeRequestBody({
        code: "code_123",
        redirectUrl: "https://mistle.example.com/oauth/callback",
        pkceVerifier: "verifier_789",
      }).toString(),
    ).toBe(
      "grant_type=authorization_code&code=code_123&redirect_uri=https%3A%2F%2Fmistle.example.com%2Foauth%2Fcallback&code_verifier=verifier_789",
    );

    expect(
      buildXeroRefreshRequestBody({
        refreshToken: "refresh_123",
      }).toString(),
    ).toBe("grant_type=refresh_token&refresh_token=refresh_123");
  });

  it("builds the Xero Basic authorization header for token endpoint client authentication", () => {
    expect(
      buildXeroBasicAuthorizationHeader({
        clientId: "xero_client_123",
        clientSecret: "xero_secret_456",
      }),
    ).toBe("Basic eGVyb19jbGllbnRfMTIzOnhlcm9fc2VjcmV0XzQ1Ng==");
  });

  it("starts authorization through the capability and stores client secret in provider state", async () => {
    const result = await XeroMcpOAuth2AuthorizationCodeCapability.startAuthorization({
      organizationId: "org_123",
      targetKey: "xero-mcp",
      target: {
        familyId: "xero",
        variantId: "xero-mcp",
        enabled: true,
        config: {},
        secrets: {},
      },
      connectionConfig: {
        client_id: "xero_client_123",
        client_secret: "xero_secret_456",
        scopes: ["offline_access", "accounting.transactions"],
      },
      intent: "create",
      redirectUrl: "https://mistle.example.com/oauth/callback",
      state: "state_abc",
      pkce: {
        challenge: "challenge_456",
        challengeMethod: "S256",
      },
    });

    expect(result.authorizationUrl).toContain("https://login.xero.com/identity/connect/authorize");
    expect(result.providerState).toEqual({
      clientId: "xero_client_123",
      clientSecret: "xero_secret_456",
      scopes: ["offline_access", "accounting.transactions"],
    });
  });

  it("requires PKCE when starting authorization", () => {
    expect(() =>
      XeroMcpOAuth2AuthorizationCodeCapability.startAuthorization({
        organizationId: "org_123",
        targetKey: "xero-mcp",
        target: {
          familyId: "xero",
          variantId: "xero-mcp",
          enabled: true,
          config: {},
          secrets: {},
        },
        connectionConfig: {
          client_id: "xero_client_123",
          client_secret: "xero_secret_456",
          scopes: ["offline_access"],
        },
        intent: "create",
        redirectUrl: "https://mistle.example.com/oauth/callback",
        state: "state_abc",
      }),
    ).toThrow("Xero OAuth authorization requires PKCE.");
  });

  it("resolves callback authorization codes and provider errors", () => {
    expect(resolveXeroAuthorizationCodeOrThrow(new URLSearchParams("code=code_123"))).toBe(
      "code_123",
    );

    expect(() =>
      resolveXeroAuthorizationCodeOrThrow(
        new URLSearchParams("error=access_denied&error_description=Denied"),
      ),
    ).toThrow("Xero OAuth authorization failed with error 'access_denied': Denied");

    expect(() =>
      resolveXeroAuthorizationCodeOrThrow(new URLSearchParams("state=state_abc")),
    ).toThrow("Xero OAuth callback query must include `code`.");
  });

  it("resolves grant and refresh results with token expiry and scope metadata", () => {
    const issuedAt = new Date("2026-06-23T00:00:00.000Z");

    expect(
      resolveXeroCompleteGrantResult({
        providerState: {
          clientId: "xero_client_123",
          clientSecret: "xero_secret_456",
          scopes: ["offline_access", "accounting.transactions"],
        },
        response: {
          access_token: "access_123",
          refresh_token: "refresh_123",
          expires_in: "1800",
          scope: "offline_access accounting.transactions",
        },
        issuedAt,
      }),
    ).toMatchObject({
      connectionConfig: {
        connection_method: "oauth2-authorization-code",
        client_id: "xero_client_123",
        scopes: ["offline_access", "accounting.transactions"],
      },
      accessToken: "access_123",
      accessTokenExpiresAt: "2026-06-23T00:30:00.000Z",
      refreshToken: "refresh_123",
      clientSecret: "xero_secret_456",
      credentialMetadata: {
        scope: "offline_access accounting.transactions",
      },
    });

    expect(
      resolveXeroRefreshResult({
        response: {
          access_token: "access_456",
          refresh_token: "refresh_456",
          expires_in: 120,
          scope: "offline_access accounting.transactions",
        },
        issuedAt,
      }),
    ).toMatchObject({
      accessToken: "access_456",
      accessTokenExpiresAt: "2026-06-23T00:02:00.000Z",
      refreshToken: "refresh_456",
      credentialMetadata: {
        scope: "offline_access accounting.transactions",
      },
    });
  });

  it("requires a refresh token when resolving the initial grant", () => {
    expect(() =>
      resolveXeroCompleteGrantResult({
        providerState: {
          clientId: "xero_client_123",
          clientSecret: "xero_secret_456",
          scopes: ["offline_access"],
        },
        response: {
          access_token: "access_123",
          expires_in: "1800",
        },
        issuedAt: new Date("2026-06-23T00:00:00.000Z"),
      }),
    ).toThrow(
      "Xero OAuth authorization did not return a refresh token. Reconnect the integration and approve offline access.",
    );
  });

  it("rejects non-positive token expiry values", () => {
    expect(() =>
      resolveXeroAccessTokenExpiresAt({
        issuedAt: new Date("2026-06-23T00:00:00.000Z"),
        expiresIn: "0",
      }),
    ).toThrow("Expected a positive integer value, received '0'.");
  });

  it("classifies refresh failures from Xero OAuth status and error bodies", () => {
    expect(
      classifyXeroRefreshFailure({
        status: 429,
        body: '{"error":"rate_limit","error_description":"Too many requests"}',
      }),
    ).toMatchObject({
      classification:
        IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications.TEMPORARY,
      message: "Too many requests",
      code: "rate_limit",
    });

    expect(
      classifyXeroRefreshFailure({
        status: 400,
        body: '{"error":"invalid_grant","error_description":"Bad refresh token"}',
      }),
    ).toEqual({
      classification:
        IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications.PERMANENT,
      message: "Bad refresh token",
      code: "invalid_grant",
    });
  });

  it("wraps refresh transport errors as temporary refresh failures", () => {
    const error = createXeroRefreshTransportFailure({
      error: new Error("socket closed"),
    });

    expect(error).toBeInstanceOf(IntegrationOAuth2AuthorizationCodeRefreshAccessTokenError);
    expect(error.classification).toBe(
      IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications.TEMPORARY,
    );
    expect(error.message).toBe(
      "Xero OAuth refresh request failed before a response was received: socket closed",
    );
  });
});
