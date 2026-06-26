import { describe, expect, it } from "vitest";

import {
  assertKlaviyoDynamicClientRegistrationSucceeded,
  buildKlaviyoAuthorizationCodeExchangeRequestBody,
  buildKlaviyoAuthorizationUrl,
  buildKlaviyoDynamicClientRegistrationRequestBody,
  buildKlaviyoRefreshRequestBody,
  classifyKlaviyoRefreshFailure,
  createKlaviyoRefreshTransportFailure,
  KlaviyoMcpOAuth2AuthorizationCodeCapability,
  parseKlaviyoDynamicClientRegistrationResponse,
  resolveKlaviyoAuthorizationCodeOrThrow,
  resolveKlaviyoCompleteGrantResult,
  resolveKlaviyoRefreshResult,
} from "./oauth2-authorization-code.server.js";

describe("Klaviyo OAuth 2.0 authorization code", () => {
  it("builds the expected dynamic client registration request body", () => {
    expect(
      buildKlaviyoDynamicClientRegistrationRequestBody({
        redirectUrl: "https://mistle.example.com/callback",
      }),
    ).toEqual({
      client_name: "Mistle Klaviyo MCP",
      redirect_uris: ["https://mistle.example.com/callback"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    });
  });

  it("builds the expected authorization URL for Klaviyo hosted MCP", () => {
    const authorizationUrl = new URL(
      buildKlaviyoAuthorizationUrl({
        clientId: "klaviyo_client_123",
        redirectUrl: "https://mistle.example.com/callback",
        state: "state_123",
        pkceChallenge: "challenge_123",
      }),
    );

    expect(authorizationUrl.origin + authorizationUrl.pathname).toBe(
      "https://mcp.klaviyo.com/authorize",
    );
    expect(authorizationUrl.searchParams.get("response_type")).toBe("code");
    expect(authorizationUrl.searchParams.get("client_id")).toBe("klaviyo_client_123");
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(
      "https://mistle.example.com/callback",
    );
    expect(authorizationUrl.searchParams.get("state")).toBe("state_123");
    expect(authorizationUrl.searchParams.get("resource")).toBe("https://mcp.klaviyo.com");
    expect(authorizationUrl.searchParams.get("code_challenge")).toBe("challenge_123");
    expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorizationUrl.searchParams.has("scope")).toBe(false);
  });

  it("builds the expected authorization code exchange body", () => {
    expect(
      buildKlaviyoAuthorizationCodeExchangeRequestBody({
        code: "code_123",
        redirectUrl: "https://mistle.example.com/callback",
        clientId: "klaviyo_client_123",
        pkceVerifier: "verifier_789",
      }).toString(),
    ).toBe(
      "grant_type=authorization_code&code=code_123&redirect_uri=https%3A%2F%2Fmistle.example.com%2Fcallback&client_id=klaviyo_client_123&code_verifier=verifier_789&resource=https%3A%2F%2Fmcp.klaviyo.com",
    );
  });

  it("builds the expected refresh body", () => {
    expect(
      buildKlaviyoRefreshRequestBody({
        refreshToken: "refresh_123",
        clientId: "klaviyo_client_123",
      }).toString(),
    ).toBe(
      "grant_type=refresh_token&refresh_token=refresh_123&client_id=klaviyo_client_123&resource=https%3A%2F%2Fmcp.klaviyo.com",
    );
  });

  it("parses the dynamic client registration response", () => {
    expect(
      parseKlaviyoDynamicClientRegistrationResponse({
        client_id: "klaviyo_client_123",
        client_name: "Mistle Klaviyo MCP",
      }),
    ).toEqual({
      clientId: "klaviyo_client_123",
    });
  });

  it("requires an exact 201 status for dynamic client registration", () => {
    expect(() =>
      assertKlaviyoDynamicClientRegistrationSucceeded({
        status: 200,
        body: '{"client_id":"klaviyo_client_123"}',
      }),
    ).toThrow(/dynamic client registration failed \(200\)/u);

    expect(() =>
      assertKlaviyoDynamicClientRegistrationSucceeded({
        status: 201,
        body: '{"client_id":"klaviyo_client_123"}',
      }),
    ).not.toThrow();
  });

  it("resolves the authorization code and surfaces callback errors", () => {
    expect(
      resolveKlaviyoAuthorizationCodeOrThrow(
        new URLSearchParams({
          code: "code_123",
          state: "state_123",
        }),
      ),
    ).toBe("code_123");

    expect(() =>
      resolveKlaviyoAuthorizationCodeOrThrow(
        new URLSearchParams({
          error: "access_denied",
          error_description: "user declined access",
        }),
      ),
    ).toThrow(
      "Klaviyo OAuth authorization failed with error 'access_denied': user declined access",
    );
  });

  it("derives completion output with the MCP client id and credential metadata", () => {
    expect(
      resolveKlaviyoCompleteGrantResult({
        providerState: {
          clientId: "klaviyo_client_123",
        },
        response: {
          access_token: "access_123",
          token_type: "Bearer",
          expires_in: 3600,
          refresh_token: "refresh_456",
          scope: "accounts:read profiles:read",
        },
        issuedAt: new Date("2026-06-15T00:00:00.000Z"),
      }),
    ).toMatchObject({
      connectionConfig: {
        connection_method: "oauth2-authorization-code",
        client_id: "klaviyo_client_123",
      },
      accessToken: "access_123",
      accessTokenExpiresAt: "2026-06-15T01:00:00.000Z",
      refreshToken: "refresh_456",
      credentialMetadata: {
        scope: "accounts:read profiles:read",
      },
    });
  });

  it("derives refresh output with a rotated refresh token", () => {
    expect(
      resolveKlaviyoRefreshResult({
        response: {
          access_token: "access_789",
          token_type: "Bearer",
          expires_in: 1800,
          refresh_token: "refresh_789",
        },
        issuedAt: new Date("2026-06-15T00:00:00.000Z"),
      }),
    ).toMatchObject({
      accessToken: "access_789",
      accessTokenExpiresAt: "2026-06-15T00:30:00.000Z",
      refreshToken: "refresh_789",
    });
  });

  it("accepts an empty token response scope and omits credential metadata", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          access_token: "access_123",
          expires_in: 3600,
          refresh_token: "refresh_456",
          scope: "",
          token_type: "Bearer",
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      )) as typeof fetch;

    try {
      const result =
        await KlaviyoMcpOAuth2AuthorizationCodeCapability.completeAuthorizationCodeGrant({
          organizationId: "org_123",
          targetKey: "klaviyo-mcp",
          target: {
            familyId: "klaviyo",
            variantId: "klaviyo-mcp",
            enabled: true,
            config: {},
            secrets: {},
          },
          pkceVerifier: "verifier_123",
          providerState: {
            clientId: "klaviyo_client_123",
          },
          query: new URLSearchParams({
            code: "code_123",
          }),
          redirectUrl: "https://mistle.example.com/callback",
        });

      expect(result).toMatchObject({
        accessToken: "access_123",
        refreshToken: "refresh_456",
      });
      expect(result).not.toHaveProperty("credentialMetadata");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("classifies permanent and temporary refresh failures", () => {
    expect(
      classifyKlaviyoRefreshFailure({
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
      classifyKlaviyoRefreshFailure({
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
      classifyKlaviyoRefreshFailure({
        status: 502,
        body: "bad gateway",
      }),
    ).toEqual({
      classification: "temporary",
      message: "Klaviyo OAuth refresh failed with status 502: bad gateway",
    });
  });

  it("converts refresh transport failures into temporary classified errors", () => {
    const error = createKlaviyoRefreshTransportFailure({
      error: new Error("network down"),
    });

    expect(error.classification).toBe("temporary");
    expect(error.message).toBe(
      "Klaviyo OAuth refresh request failed before a response was received: network down",
    );
  });
});
