import { describe, expect, it } from "vitest";

import { ExpoConnectionConfigSchema } from "./auth.js";
import {
  assertExpoDynamicClientRegistrationSucceeded,
  buildExpoAuthorizationCodeExchangeRequestBody,
  buildExpoAuthorizationUrl,
  buildExpoDynamicClientRegistrationRequestBody,
  buildExpoRefreshRequestBody,
  classifyExpoRefreshFailure,
  createExpoRefreshTransportFailure,
  parseExpoDynamicClientRegistrationResponse,
  resolveExpoAuthorizationCodeOrThrow,
  resolveExpoCompleteGrantResult,
  resolveExpoRefreshResult,
} from "./oauth2-authorization-code.server.js";

describe("Expo OAuth 2.0 authorization code", () => {
  it("builds the expected dynamic client registration request body", () => {
    expect(
      buildExpoDynamicClientRegistrationRequestBody({
        redirectUrl: "https://mistle.example.com/callback",
      }),
    ).toEqual({
      client_name: "Mistle Expo MCP",
      redirect_uris: ["https://mistle.example.com/callback"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: "mcp:access",
      token_endpoint_auth_method: "none",
    });
  });

  it("builds the expected authorization URL for Expo hosted MCP", () => {
    const authorizationUrl = new URL(
      buildExpoAuthorizationUrl({
        clientId: "expo_client_123",
        redirectUrl: "https://mistle.example.com/callback",
        state: "state_123",
        pkceChallenge: "challenge_123",
      }),
    );

    expect(authorizationUrl.origin + authorizationUrl.pathname).toBe(
      "https://mcp.expo.dev/oauth/authorize",
    );
    expect(authorizationUrl.searchParams.get("response_type")).toBe("code");
    expect(authorizationUrl.searchParams.get("client_id")).toBe("expo_client_123");
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(
      "https://mistle.example.com/callback",
    );
    expect(authorizationUrl.searchParams.get("state")).toBe("state_123");
    expect(authorizationUrl.searchParams.get("scope")).toBe("mcp:access");
    expect(authorizationUrl.searchParams.get("resource")).toBe("https://mcp.expo.dev/mcp");
    expect(authorizationUrl.searchParams.get("code_challenge")).toBe("challenge_123");
    expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("builds the expected authorization code exchange body", () => {
    expect(
      buildExpoAuthorizationCodeExchangeRequestBody({
        code: "code_123",
        redirectUrl: "https://mistle.example.com/callback",
        clientId: "expo_client_123",
        pkceVerifier: "verifier_789",
      }).toString(),
    ).toBe(
      "grant_type=authorization_code&code=code_123&redirect_uri=https%3A%2F%2Fmistle.example.com%2Fcallback&client_id=expo_client_123&code_verifier=verifier_789&resource=https%3A%2F%2Fmcp.expo.dev%2Fmcp",
    );
  });

  it("builds the expected refresh body", () => {
    expect(
      buildExpoRefreshRequestBody({
        refreshToken: "refresh_123",
        clientId: "expo_client_123",
      }).toString(),
    ).toBe(
      "grant_type=refresh_token&refresh_token=refresh_123&client_id=expo_client_123&resource=https%3A%2F%2Fmcp.expo.dev%2Fmcp",
    );
  });

  it("parses the dynamic client registration response", () => {
    expect(
      parseExpoDynamicClientRegistrationResponse({
        client_id: "expo_client_123",
        client_name: "Mistle Expo MCP",
      }),
    ).toEqual({
      clientId: "expo_client_123",
    });
  });

  it("requires an exact 201 status for dynamic client registration", () => {
    expect(() =>
      assertExpoDynamicClientRegistrationSucceeded({
        status: 200,
        body: '{"client_id":"expo_client_123"}',
      }),
    ).toThrow(/dynamic client registration failed \(200\)/u);

    expect(() =>
      assertExpoDynamicClientRegistrationSucceeded({
        status: 201,
        body: '{"client_id":"expo_client_123"}',
      }),
    ).not.toThrow();
  });

  it("resolves the authorization code and surfaces callback errors", () => {
    expect(
      resolveExpoAuthorizationCodeOrThrow(
        new URLSearchParams({
          code: "code_123",
          state: "state_123",
        }),
      ),
    ).toBe("code_123");

    expect(() =>
      resolveExpoAuthorizationCodeOrThrow(
        new URLSearchParams({
          error: "access_denied",
          error_description: "user declined access",
        }),
      ),
    ).toThrow("Expo OAuth authorization failed with error 'access_denied': user declined access");
  });

  it("derives completion output with the MCP client id and credential metadata", () => {
    const result = resolveExpoCompleteGrantResult({
      providerState: {
        clientId: "expo_client_123",
      },
      response: {
        access_token: "access_123",
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: "refresh_456",
        scope: "mcp:access",
      },
      issuedAt: new Date("2026-04-11T00:00:00.000Z"),
    });

    expect(result).toMatchObject({
      connectionConfig: {
        connection_method: "oauth2-authorization-code",
        client_id: "expo_client_123",
      },
      accessToken: "access_123",
      accessTokenExpiresAt: "2026-04-11T01:00:00.000Z",
      refreshToken: "refresh_456",
      credentialMetadata: {
        scope: "mcp:access",
      },
    });
    expect(ExpoConnectionConfigSchema.parse(result.connectionConfig)).toEqual(
      result.connectionConfig,
    );
  });

  it("derives refresh output with a rotated refresh token", () => {
    expect(
      resolveExpoRefreshResult({
        response: {
          access_token: "access_789",
          token_type: "Bearer",
          expires_in: 1800,
          refresh_token: "refresh_789",
        },
        issuedAt: new Date("2026-04-11T00:00:00.000Z"),
      }),
    ).toMatchObject({
      accessToken: "access_789",
      accessTokenExpiresAt: "2026-04-11T00:30:00.000Z",
      refreshToken: "refresh_789",
    });
  });

  it("classifies permanent and temporary refresh failures", () => {
    expect(
      classifyExpoRefreshFailure({
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
      classifyExpoRefreshFailure({
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
      classifyExpoRefreshFailure({
        status: 502,
        body: "bad gateway",
      }),
    ).toEqual({
      classification: "temporary",
      message: "Expo OAuth refresh failed with status 502: bad gateway",
    });
  });

  it("converts refresh transport failures into temporary classified errors", () => {
    const error = createExpoRefreshTransportFailure({
      error: new Error("network down"),
    });

    expect(error.classification).toBe("temporary");
    expect(error.message).toContain("network down");
  });
});
