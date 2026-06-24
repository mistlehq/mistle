import { describe, expect, it } from "vitest";

import {
  buildGoogleWorkspaceAuthorizationCodeExchangeRequestBody,
  buildGoogleWorkspaceAuthorizationUrl,
  buildGoogleWorkspaceRefreshRequestBody,
  classifyGoogleWorkspaceRefreshFailure,
  GoogleWorkspaceMcpOAuth2AuthorizationCodeCapability,
  resolveGoogleWorkspaceCompleteGrantResult,
  resolveGoogleWorkspaceRefreshResult,
} from "./oauth2-authorization-code.server.js";

describe("Google Workspace OAuth authorization code helpers", () => {
  it("builds a Google authorization URL with offline access and Workspace scopes", () => {
    const authorizationUrl = new URL(
      buildGoogleWorkspaceAuthorizationUrl({
        clientId: "google_client_123.apps.googleusercontent.com",
        redirectUrl: "https://mistle.example.com/oauth/callback",
        state: "state_123",
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
    expect(authorizationUrl.searchParams.get("state")).toBe("state_123");
    expect(authorizationUrl.searchParams.get("scope")).toBe(
      [
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/gmail.compose",
        "https://www.googleapis.com/auth/drive.readonly",
        "https://www.googleapis.com/auth/drive.file",
        "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
        "https://www.googleapis.com/auth/calendar.events.freebusy",
        "https://www.googleapis.com/auth/calendar.events.readonly",
        "https://www.googleapis.com/auth/chat.spaces.readonly",
        "https://www.googleapis.com/auth/chat.memberships.readonly",
        "https://www.googleapis.com/auth/chat.messages.readonly",
        "https://www.googleapis.com/auth/chat.messages.create",
        "https://www.googleapis.com/auth/chat.users.readstate.readonly",
        "https://www.googleapis.com/auth/directory.readonly",
        "https://www.googleapis.com/auth/userinfo.profile",
        "https://www.googleapis.com/auth/contacts.readonly",
      ].join(" "),
    );
    expect(authorizationUrl.searchParams.get("access_type")).toBe("offline");
    expect(authorizationUrl.searchParams.get("prompt")).toBe("consent");
    expect(authorizationUrl.searchParams.get("code_challenge")).toBe("challenge_456");
    expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("builds token exchange and refresh request bodies with the BYO client credentials", () => {
    expect(
      buildGoogleWorkspaceAuthorizationCodeExchangeRequestBody({
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
      buildGoogleWorkspaceRefreshRequestBody({
        refreshToken: "refresh_123",
        clientId: "google_client_123.apps.googleusercontent.com",
        clientSecret: "google_secret_456",
      }).toString(),
    ).toBe(
      "grant_type=refresh_token&refresh_token=refresh_123&client_id=google_client_123.apps.googleusercontent.com&client_secret=google_secret_456",
    );
  });

  it("starts authorization from BYO client credentials without storing the secret in connection config", () => {
    expect(
      GoogleWorkspaceMcpOAuth2AuthorizationCodeCapability.startAuthorization({
        organizationId: "org_123",
        targetKey: "google-workspace-mcp",
        target: {
          familyId: "google-workspace",
          variantId: "google-workspace-mcp",
          enabled: true,
          config: {},
          secrets: {},
        },
        connectionConfig: {
          client_id: "google_client_123.apps.googleusercontent.com",
          client_secret: "google_secret_456",
        },
        intent: "create",
        state: "state_123",
        redirectUrl: "https://mistle.example.com/oauth/callback",
        pkce: {
          challenge: "challenge_456",
          challengeMethod: "S256",
        },
      }),
    ).toMatchObject({
      authorizationUrl: expect.stringContaining("https://accounts.google.com/o/oauth2/v2/auth"),
      providerState: {
        clientId: "google_client_123.apps.googleusercontent.com",
        clientSecret: "google_secret_456",
      },
    });
  });

  it("resolves grant and refresh results with token expiry and scope metadata", () => {
    expect(
      resolveGoogleWorkspaceCompleteGrantResult({
        providerState: {
          clientId: "google_client_123.apps.googleusercontent.com",
          clientSecret: "google_secret_456",
        },
        response: {
          access_token: "access_123",
          refresh_token: "refresh_123",
          expires_in: 3600,
          scope: "https://www.googleapis.com/auth/gmail.readonly",
        },
        issuedAt: new Date("2026-01-01T00:00:00.000Z"),
      }),
    ).toMatchObject({
      connectionConfig: {
        client_id: "google_client_123.apps.googleusercontent.com",
      },
      accessToken: "access_123",
      accessTokenExpiresAt: "2026-01-01T01:00:00.000Z",
      refreshToken: "refresh_123",
      clientSecret: "google_secret_456",
      credentialMetadata: {
        scope: "https://www.googleapis.com/auth/gmail.readonly",
      },
    });

    expect(
      resolveGoogleWorkspaceRefreshResult({
        response: {
          access_token: "access_456",
          expires_in: "1800",
        },
        issuedAt: new Date("2026-01-01T00:00:00.000Z"),
      }),
    ).toMatchObject({
      accessToken: "access_456",
      accessTokenExpiresAt: "2026-01-01T00:30:00.000Z",
    });
  });

  it("rejects an initial grant response without a refresh token", () => {
    expect(() =>
      resolveGoogleWorkspaceCompleteGrantResult({
        providerState: {
          clientId: "google_client_123.apps.googleusercontent.com",
          clientSecret: "google_secret_456",
        },
        response: {
          access_token: "access_123",
          expires_in: 3600,
        },
        issuedAt: new Date("2026-01-01T00:00:00.000Z"),
      }),
    ).toThrow(
      "Google Workspace OAuth authorization did not return a refresh token. Reconnect the integration and approve offline access.",
    );
  });

  it("classifies Google refresh credential failures", () => {
    expect(
      classifyGoogleWorkspaceRefreshFailure({
        status: 400,
        body: '{"error":"invalid_grant","error_description":"Bad refresh token"}',
      }),
    ).toMatchObject({
      classification: "permanent",
      message: "Bad refresh token",
      code: "invalid_grant",
    });

    expect(
      classifyGoogleWorkspaceRefreshFailure({
        status: 500,
        body: '{"error":"server_error"}',
      }),
    ).toEqual({
      classification: "temporary",
      message: "Google Workspace access token refresh failed with status 500.",
      code: "server_error",
    });

    expect(
      classifyGoogleWorkspaceRefreshFailure({
        status: 429,
        body: "too many requests",
      }),
    ).toEqual({
      classification: "temporary",
      message: "Google Workspace access token refresh failed with status 429.",
    });

    expect(
      classifyGoogleWorkspaceRefreshFailure({
        status: 400,
        body: '{"error":"temporarily_unavailable"}',
      }),
    ).toEqual({
      classification: "temporary",
      message: "Google Workspace access token refresh failed with status 400.",
      code: "temporarily_unavailable",
    });
  });
});
