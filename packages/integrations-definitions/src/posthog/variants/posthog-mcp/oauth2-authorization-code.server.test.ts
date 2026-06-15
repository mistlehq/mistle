import { describe, expect, it } from "vitest";

import {
  assertPostHogDynamicClientRegistrationSucceeded,
  buildPostHogAuthorizationCodeExchangeRequestBody,
  buildPostHogAuthorizationUrl,
  buildPostHogDynamicClientRegistrationRequestBody,
  buildPostHogRefreshRequestBody,
  classifyPostHogRefreshFailure,
  createPostHogRefreshTransportFailure,
  parsePostHogDynamicClientRegistrationResponse,
  resolvePostHogAuthorizationCodeOrThrow,
  resolvePostHogCompleteGrantResult,
  resolvePostHogRefreshResult,
} from "./oauth2-authorization-code.server.js";

describe("PostHog OAuth 2.0 authorization code", () => {
  it("builds the expected dynamic client registration request body", () => {
    expect(
      buildPostHogDynamicClientRegistrationRequestBody({
        redirectUrl: "https://mistle.example.com/callback",
      }),
    ).toEqual({
      client_name: "Mistle PostHog MCP",
      redirect_uris: ["https://mistle.example.com/callback"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    });
  });

  it("builds the expected authorization URL for PostHog hosted MCP", () => {
    const authorizationUrl = new URL(
      buildPostHogAuthorizationUrl({
        clientId: "posthog_client_123",
        redirectUrl: "https://mistle.example.com/callback",
        state: "state_123",
        pkceChallenge: "challenge_123",
      }),
    );

    expect(authorizationUrl.origin + authorizationUrl.pathname).toBe(
      "https://oauth.posthog.com/oauth/authorize/",
    );
    expect(authorizationUrl.searchParams.get("response_type")).toBe("code");
    expect(authorizationUrl.searchParams.get("client_id")).toBe("posthog_client_123");
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(
      "https://mistle.example.com/callback",
    );
    expect(authorizationUrl.searchParams.get("state")).toBe("state_123");
    expect(authorizationUrl.searchParams.get("resource")).toBe("https://mcp.posthog.com/mcp");
    expect(authorizationUrl.searchParams.get("code_challenge")).toBe("challenge_123");
    expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe("S256");

    const requestedScopes = authorizationUrl.searchParams.get("scope")?.split(" ");
    expect(requestedScopes).toEqual(
      expect.arrayContaining([
        "openid",
        "profile",
        "email",
        "feature_flag:write",
        "error_tracking:write",
        "query:read",
        "dashboard:write",
      ]),
    );
    expect(requestedScopes).not.toContain("insight_variable:read");
  });

  it("builds the expected authorization code exchange body", () => {
    expect(
      buildPostHogAuthorizationCodeExchangeRequestBody({
        code: "code_123",
        redirectUrl: "https://mistle.example.com/callback",
        clientId: "posthog_client_123",
        pkceVerifier: "verifier_789",
      }).toString(),
    ).toBe(
      "grant_type=authorization_code&code=code_123&redirect_uri=https%3A%2F%2Fmistle.example.com%2Fcallback&client_id=posthog_client_123&code_verifier=verifier_789&resource=https%3A%2F%2Fmcp.posthog.com%2Fmcp",
    );
  });

  it("builds the expected refresh body", () => {
    expect(
      buildPostHogRefreshRequestBody({
        refreshToken: "refresh_123",
        clientId: "posthog_client_123",
      }).toString(),
    ).toBe(
      "grant_type=refresh_token&refresh_token=refresh_123&client_id=posthog_client_123&resource=https%3A%2F%2Fmcp.posthog.com%2Fmcp",
    );
  });

  it("parses the dynamic client registration response", () => {
    expect(
      parsePostHogDynamicClientRegistrationResponse({
        client_id: "posthog_client_123",
        client_name: "Mistle PostHog MCP",
      }),
    ).toEqual({
      clientId: "posthog_client_123",
    });
  });

  it("requires an exact 201 status for dynamic client registration", () => {
    expect(() =>
      assertPostHogDynamicClientRegistrationSucceeded({
        status: 200,
        body: '{"client_id":"posthog_client_123"}',
      }),
    ).toThrow(/dynamic client registration failed \(200\)/u);

    expect(() =>
      assertPostHogDynamicClientRegistrationSucceeded({
        status: 201,
        body: '{"client_id":"posthog_client_123"}',
      }),
    ).not.toThrow();
  });

  it("resolves the authorization code and surfaces callback errors", () => {
    expect(
      resolvePostHogAuthorizationCodeOrThrow(
        new URLSearchParams({
          code: "code_123",
          state: "state_123",
        }),
      ),
    ).toBe("code_123");

    expect(() =>
      resolvePostHogAuthorizationCodeOrThrow(
        new URLSearchParams({
          error: "access_denied",
          error_description: "user declined access",
        }),
      ),
    ).toThrow(
      "PostHog OAuth authorization failed with error 'access_denied': user declined access",
    );
  });

  it("derives completion output with the MCP client id and credential metadata", () => {
    expect(
      resolvePostHogCompleteGrantResult({
        providerState: {
          clientId: "posthog_client_123",
        },
        response: {
          access_token: "access_123",
          token_type: "Bearer",
          expires_in: 3600,
          refresh_token: "refresh_456",
          scope: "openid profile feature_flag:write",
        },
        issuedAt: new Date("2026-06-15T00:00:00.000Z"),
      }),
    ).toEqual({
      connectionConfig: {
        client_id: "posthog_client_123",
      },
      accessToken: "access_123",
      accessTokenExpiresAt: "2026-06-15T01:00:00.000Z",
      refreshToken: "refresh_456",
      credentialMetadata: {
        scope: "openid profile feature_flag:write",
      },
    });
  });

  it("derives refresh output with a rotated refresh token", () => {
    expect(
      resolvePostHogRefreshResult({
        response: {
          access_token: "access_789",
          token_type: "Bearer",
          expires_in: 1800,
          refresh_token: "refresh_789",
        },
        issuedAt: new Date("2026-06-15T00:00:00.000Z"),
      }),
    ).toEqual({
      accessToken: "access_789",
      accessTokenExpiresAt: "2026-06-15T00:30:00.000Z",
      refreshToken: "refresh_789",
    });
  });

  it("classifies permanent and temporary refresh failures", () => {
    expect(
      classifyPostHogRefreshFailure({
        status: 400,
        body: JSON.stringify({
          error: "invalid_grant",
          error_description: "refresh token expired",
        }),
      }),
    ).toEqual({
      classification: "permanent",
      code: "invalid_grant",
      message: "refresh token expired",
    });

    expect(
      classifyPostHogRefreshFailure({
        status: 503,
        body: JSON.stringify({
          error: "server_error",
          error_description: "temporary outage",
        }),
      }),
    ).toEqual({
      classification: "temporary",
      code: "server_error",
      message: "temporary outage",
    });

    expect(
      classifyPostHogRefreshFailure({
        status: 502,
        body: "bad gateway",
      }),
    ).toEqual({
      classification: "temporary",
      message: "PostHog OAuth refresh failed with status 502: bad gateway",
    });
  });

  it("converts refresh transport failures into temporary classified errors", () => {
    const error = createPostHogRefreshTransportFailure({
      error: new Error("network down"),
    });

    expect(error.classification).toBe("temporary");
    expect(error.message).toBe(
      "PostHog OAuth refresh request failed before a response was received: network down",
    );
  });
});
