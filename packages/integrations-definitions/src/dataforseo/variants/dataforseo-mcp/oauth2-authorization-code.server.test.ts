import { describe, expect, it } from "vitest";

import {
  assertDataForSeoDynamicClientRegistrationSucceeded,
  buildDataForSeoAuthorizationCodeExchangeRequestBody,
  buildDataForSeoAuthorizationUrl,
  buildDataForSeoDynamicClientRegistrationRequestBody,
  buildDataForSeoRefreshRequestBody,
  classifyDataForSeoRefreshFailure,
  createDataForSeoRefreshTransportFailure,
  parseDataForSeoDynamicClientRegistrationResponse,
  resolveDataForSeoAuthorizationCodeOrThrow,
  resolveDataForSeoCompleteGrantResult,
  resolveDataForSeoRefreshResult,
} from "./oauth2-authorization-code.server.js";

describe("DataForSEO OAuth 2.0 authorization code", () => {
  it("builds the expected dynamic client registration request body", () => {
    expect(
      buildDataForSeoDynamicClientRegistrationRequestBody({
        redirectUrl: "https://mistle.example.com/callback",
      }),
    ).toEqual({
      client_name: "Mistle DataForSEO MCP",
      redirect_uris: ["https://mistle.example.com/callback"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    });
  });

  it("builds the expected authorization URL for DataForSEO hosted MCP", () => {
    const authorizationUrl = new URL(
      buildDataForSeoAuthorizationUrl({
        clientId: "dataforseo_client_123",
        redirectUrl: "https://mistle.example.com/callback",
        state: "state_123",
        pkceChallenge: "challenge_123",
      }),
    );

    expect(authorizationUrl.origin + authorizationUrl.pathname).toBe(
      "https://data.dataforseo.com/oauth/authorize",
    );
    expect(authorizationUrl.searchParams.get("response_type")).toBe("code");
    expect(authorizationUrl.searchParams.get("client_id")).toBe("dataforseo_client_123");
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(
      "https://mistle.example.com/callback",
    );
    expect(authorizationUrl.searchParams.get("state")).toBe("state_123");
    expect(authorizationUrl.searchParams.get("resource")).toBe("https://mcp.dataforseo.com");
    expect(authorizationUrl.searchParams.get("code_challenge")).toBe("challenge_123");
    expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorizationUrl.searchParams.get("scope")).toBe("api");
  });

  it("builds the expected authorization code exchange body", () => {
    expect(
      buildDataForSeoAuthorizationCodeExchangeRequestBody({
        code: "code_123",
        redirectUrl: "https://mistle.example.com/callback",
        clientId: "dataforseo_client_123",
        pkceVerifier: "verifier_789",
      }).toString(),
    ).toBe(
      "grant_type=authorization_code&code=code_123&redirect_uri=https%3A%2F%2Fmistle.example.com%2Fcallback&client_id=dataforseo_client_123&code_verifier=verifier_789&resource=https%3A%2F%2Fmcp.dataforseo.com",
    );
  });

  it("builds the expected refresh body", () => {
    expect(
      buildDataForSeoRefreshRequestBody({
        refreshToken: "refresh_123",
        clientId: "dataforseo_client_123",
      }).toString(),
    ).toBe(
      "grant_type=refresh_token&refresh_token=refresh_123&client_id=dataforseo_client_123&resource=https%3A%2F%2Fmcp.dataforseo.com",
    );
  });

  it("parses the dynamic client registration response", () => {
    expect(
      parseDataForSeoDynamicClientRegistrationResponse({
        client_id: "dataforseo_client_123",
        client_name: "Mistle DataForSEO MCP",
      }),
    ).toEqual({
      clientId: "dataforseo_client_123",
    });
  });

  it("requires an exact 201 status for dynamic client registration", () => {
    expect(() =>
      assertDataForSeoDynamicClientRegistrationSucceeded({
        status: 200,
        body: '{"client_id":"dataforseo_client_123"}',
      }),
    ).toThrow(/dynamic client registration failed \(200\)/u);

    expect(() =>
      assertDataForSeoDynamicClientRegistrationSucceeded({
        status: 201,
        body: '{"client_id":"dataforseo_client_123"}',
      }),
    ).not.toThrow();
  });

  it("resolves the authorization code and surfaces callback errors", () => {
    expect(
      resolveDataForSeoAuthorizationCodeOrThrow(
        new URLSearchParams({
          code: "code_123",
          state: "state_123",
        }),
      ),
    ).toBe("code_123");

    expect(() =>
      resolveDataForSeoAuthorizationCodeOrThrow(
        new URLSearchParams({
          error: "access_denied",
          error_description: "user declined access",
        }),
      ),
    ).toThrow(
      "DataForSEO OAuth authorization failed with error 'access_denied': user declined access",
    );
  });

  it("derives completion output with the MCP client id and credential metadata", () => {
    expect(
      resolveDataForSeoCompleteGrantResult({
        providerState: {
          clientId: "dataforseo_client_123",
        },
        response: {
          access_token: "access_123",
          token_type: "Bearer",
          expires_in: 3600,
          refresh_token: "refresh_456",
          scope: "api",
        },
        issuedAt: new Date("2026-06-15T00:00:00.000Z"),
      }),
    ).toEqual({
      connectionConfig: {
        client_id: "dataforseo_client_123",
      },
      accessToken: "access_123",
      accessTokenExpiresAt: "2026-06-15T01:00:00.000Z",
      refreshToken: "refresh_456",
      credentialMetadata: {
        scope: "api",
      },
    });
  });

  it("derives refresh output with a rotated refresh token", () => {
    expect(
      resolveDataForSeoRefreshResult({
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
      classifyDataForSeoRefreshFailure({
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
      classifyDataForSeoRefreshFailure({
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
      classifyDataForSeoRefreshFailure({
        status: 502,
        body: "bad gateway",
      }),
    ).toEqual({
      classification: "temporary",
      message: "DataForSEO OAuth refresh failed with status 502: bad gateway",
    });
  });

  it("converts refresh transport failures into temporary classified errors", () => {
    const error = createDataForSeoRefreshTransportFailure({
      error: new Error("network down"),
    });

    expect(error.classification).toBe("temporary");
    expect(error.message).toBe(
      "DataForSEO OAuth refresh request failed before a response was received: network down",
    );
  });
});
