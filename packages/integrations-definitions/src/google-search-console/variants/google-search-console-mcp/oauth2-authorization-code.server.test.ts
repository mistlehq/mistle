import {
  IntegrationOAuth2AuthorizationCodeRefreshAccessTokenError,
  IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications,
} from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import {
  buildGoogleSearchConsoleAuthorizationCodeExchangeRequestBody,
  buildGoogleSearchConsoleAuthorizationUrl,
  buildGoogleSearchConsoleRefreshRequestBody,
  classifyGoogleSearchConsoleRefreshFailure,
  createGoogleSearchConsoleRefreshTransportFailure,
  GoogleSearchConsoleMcpOAuth2AuthorizationCodeCapability,
  resolveGoogleSearchConsoleAccessTokenExpiresAt,
  resolveGoogleSearchConsoleAuthorizationCodeOrThrow,
  resolveGoogleSearchConsoleCompleteGrantResult,
  resolveGoogleSearchConsoleRefreshResult,
} from "./oauth2-authorization-code.server.js";

describe("Google Search Console OAuth authorization code support", () => {
  it("builds a Google authorization URL with offline access and the Google Search Console readonly scope", () => {
    const authorizationUrl = new URL(
      buildGoogleSearchConsoleAuthorizationUrl({
        clientId: "google_client_123.apps.googleusercontent.com",
        redirectUrl: "https://mistle.example.com/oauth/callback",
        state: "state_abc",
        pkceChallenge: "challenge_456",
      }),
    );

    expect(authorizationUrl.origin).toBe("https://accounts.google.com");
    expect(authorizationUrl.pathname).toBe("/o/oauth2/v2/auth");
    expect(authorizationUrl.searchParams.get("response_type")).toBe("code");
    expect(authorizationUrl.searchParams.get("client_id")).toBe(
      "google_client_123.apps.googleusercontent.com",
    );
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(
      "https://mistle.example.com/oauth/callback",
    );
    expect(authorizationUrl.searchParams.get("state")).toBe("state_abc");
    expect(authorizationUrl.searchParams.get("scope")).toBe(
      "https://www.googleapis.com/auth/webmasters.readonly",
    );
    expect(authorizationUrl.searchParams.get("access_type")).toBe("offline");
    expect(authorizationUrl.searchParams.get("prompt")).toBe("consent");
    expect(authorizationUrl.searchParams.get("code_challenge")).toBe("challenge_456");
    expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("builds Google token exchange and refresh request bodies", () => {
    expect(
      buildGoogleSearchConsoleAuthorizationCodeExchangeRequestBody({
        code: "code_123",
        redirectUrl: "https://mistle.example.com/oauth/callback",
        clientId: "google_client_123.apps.googleusercontent.com",
        clientSecret: "google_secret_456",
        pkceVerifier: "verifier_789",
      }).toString(),
    ).toBe(
      "grant_type=authorization_code&code=code_123&redirect_uri=https%3A%2F%2Fmistle.example.com%2Foauth%2Fcallback&client_id=google_client_123.apps.googleusercontent.com&client_secret=google_secret_456&code_verifier=verifier_789",
    );

    expect(
      buildGoogleSearchConsoleRefreshRequestBody({
        refreshToken: "refresh_123",
        clientId: "google_client_123.apps.googleusercontent.com",
        clientSecret: "google_secret_456",
      }).toString(),
    ).toBe(
      "grant_type=refresh_token&refresh_token=refresh_123&client_id=google_client_123.apps.googleusercontent.com&client_secret=google_secret_456",
    );
  });

  it("starts authorization through the capability and stores client secret in provider state", async () => {
    const result = await GoogleSearchConsoleMcpOAuth2AuthorizationCodeCapability.startAuthorization(
      {
        organizationId: "org_123",
        targetKey: "google-search-console-mcp",
        target: {
          familyId: "google-search-console",
          variantId: "google-search-console-mcp",
          enabled: true,
          config: {},
          secrets: {},
        },
        connectionConfig: {
          client_id: "google_client_123.apps.googleusercontent.com",
          client_secret: "google_secret_456",
        },
        redirectUrl: "https://mistle.example.com/oauth/callback",
        intent: "create",
        state: "state_abc",
        pkce: {
          challenge: "challenge_456",
          challengeMethod: "S256",
        },
      },
    );

    expect(result.authorizationUrl).toContain("https://accounts.google.com/o/oauth2/v2/auth");
    expect(result.providerState).toEqual({
      clientId: "google_client_123.apps.googleusercontent.com",
      clientSecret: "google_secret_456",
    });
  });

  it("requires PKCE when starting authorization", () => {
    expect(() =>
      GoogleSearchConsoleMcpOAuth2AuthorizationCodeCapability.startAuthorization({
        organizationId: "org_123",
        targetKey: "google-search-console-mcp",
        target: {
          familyId: "google-search-console",
          variantId: "google-search-console-mcp",
          enabled: true,
          config: {},
          secrets: {},
        },
        connectionConfig: {
          client_id: "google_client_123.apps.googleusercontent.com",
          client_secret: "google_secret_456",
        },
        redirectUrl: "https://mistle.example.com/oauth/callback",
        intent: "create",
        state: "state_abc",
      }),
    ).toThrow("Google Search Console OAuth authorization requires PKCE.");
  });

  it("resolves callback authorization codes and provider errors", () => {
    expect(
      resolveGoogleSearchConsoleAuthorizationCodeOrThrow(new URLSearchParams("code=code_123")),
    ).toBe("code_123");

    expect(() =>
      resolveGoogleSearchConsoleAuthorizationCodeOrThrow(
        new URLSearchParams("error=access_denied&error_description=Denied"),
      ),
    ).toThrow(
      "Google Search Console OAuth authorization failed with error 'access_denied': Denied",
    );

    expect(() =>
      resolveGoogleSearchConsoleAuthorizationCodeOrThrow(new URLSearchParams("state=state_abc")),
    ).toThrow("Google Search Console OAuth callback query must include `code`.");
  });

  it("resolves grant and refresh results with token expiry and scope metadata", () => {
    const issuedAt = new Date("2026-06-23T00:00:00.000Z");

    expect(
      resolveGoogleSearchConsoleCompleteGrantResult({
        providerState: {
          clientId: "google_client_123.apps.googleusercontent.com",
          clientSecret: "google_secret_456",
        },
        response: {
          access_token: "access_123",
          refresh_token: "refresh_123",
          expires_in: "3600",
          scope: "https://www.googleapis.com/auth/webmasters.readonly",
        },
        issuedAt,
      }),
    ).toMatchObject({
      connectionConfig: {
        client_id: "google_client_123.apps.googleusercontent.com",
      },
      accessToken: "access_123",
      accessTokenExpiresAt: "2026-06-23T01:00:00.000Z",
      refreshToken: "refresh_123",
      clientSecret: "google_secret_456",
      credentialMetadata: {
        scope: "https://www.googleapis.com/auth/webmasters.readonly",
      },
    });

    expect(
      resolveGoogleSearchConsoleRefreshResult({
        response: {
          access_token: "access_456",
          refresh_token: "refresh_456",
          expires_in: 120,
          scope: "https://www.googleapis.com/auth/webmasters.readonly",
        },
        issuedAt,
      }),
    ).toMatchObject({
      accessToken: "access_456",
      accessTokenExpiresAt: "2026-06-23T00:02:00.000Z",
      refreshToken: "refresh_456",
      credentialMetadata: {
        scope: "https://www.googleapis.com/auth/webmasters.readonly",
      },
    });
  });

  it("requires a refresh token when resolving the initial grant", () => {
    expect(() =>
      resolveGoogleSearchConsoleCompleteGrantResult({
        providerState: {
          clientId: "google_client_123.apps.googleusercontent.com",
          clientSecret: "google_secret_456",
        },
        response: {
          access_token: "access_123",
          expires_in: "3600",
        },
        issuedAt: new Date("2026-06-23T00:00:00.000Z"),
      }),
    ).toThrow(
      "Google Search Console OAuth authorization did not return a refresh token. Reconnect the integration and approve offline access.",
    );
  });

  it("rejects non-positive token expiry values", () => {
    expect(() =>
      resolveGoogleSearchConsoleAccessTokenExpiresAt({
        issuedAt: new Date("2026-06-23T00:00:00.000Z"),
        expiresIn: "0",
      }),
    ).toThrow("Expected a positive integer value, received '0'.");
  });

  it("classifies refresh failures from Google OAuth status and error bodies", () => {
    expect(
      classifyGoogleSearchConsoleRefreshFailure({
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
      classifyGoogleSearchConsoleRefreshFailure({
        status: 400,
        body: '{"error":"invalid_grant","error_description":"Bad refresh token"}',
      }),
    ).toEqual({
      classification:
        IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications.PERMANENT,
      message: "Bad refresh token",
      code: "invalid_grant",
    });

    expect(
      classifyGoogleSearchConsoleRefreshFailure({
        status: 200,
        body: "",
      }),
    ).toEqual({
      classification:
        IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications.TEMPORARY,
      message: "Google Search Console access token refresh failed with status 200.",
    });
  });

  it("wraps refresh transport errors as temporary refresh failures", () => {
    const error = createGoogleSearchConsoleRefreshTransportFailure({
      error: new Error("socket closed"),
    });

    expect(error).toBeInstanceOf(IntegrationOAuth2AuthorizationCodeRefreshAccessTokenError);
    expect(error.classification).toBe(
      IntegrationOAuth2AuthorizationCodeRefreshAccessTokenErrorClassifications.TEMPORARY,
    );
    expect(error.message).toBe(
      "Google Search Console OAuth refresh request failed before a response was received: socket closed",
    );
  });
});
