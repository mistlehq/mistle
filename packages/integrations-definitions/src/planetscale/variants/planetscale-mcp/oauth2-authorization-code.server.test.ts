import { describe, expect, it } from "vitest";

import {
  assertPlanetScaleDynamicClientRegistrationSucceeded,
  buildPlanetScaleAuthorizationCodeExchangeRequestBody,
  buildPlanetScaleAuthorizationUrl,
  buildPlanetScaleDynamicClientRegistrationRequestBody,
  buildPlanetScaleRefreshRequestBody,
  classifyPlanetScaleRefreshFailure,
  createPlanetScaleRefreshTransportFailure,
  parsePlanetScaleDynamicClientRegistrationResponse,
  resolvePlanetScaleAuthorizationCodeOrThrow,
  resolvePlanetScaleCompleteGrantResult,
  resolvePlanetScaleRefreshResult,
} from "./oauth2-authorization-code.server.js";

describe("PlanetScale OAuth 2.0 authorization code", () => {
  it("builds the expected dynamic client registration request body", () => {
    expect(
      buildPlanetScaleDynamicClientRegistrationRequestBody({
        redirectUrl: "https://mistle.example.com/callback",
      }),
    ).toEqual({
      client_name: "Mistle PlanetScale MCP",
      redirect_uris: ["https://mistle.example.com/callback"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_post",
    });
  });

  it("builds the expected authorization URL without a scope parameter", () => {
    const authorizationUrl = new URL(
      buildPlanetScaleAuthorizationUrl({
        clientId: "pscale_app_123",
        redirectUrl: "https://mistle.example.com/callback",
        state: "state_123",
        pkceChallenge: "challenge_123",
      }),
    );

    expect(authorizationUrl.origin + authorizationUrl.pathname).toBe(
      "https://app.planetscale.com/oauth/authorize",
    );
    expect(authorizationUrl.searchParams.get("response_type")).toBe("code");
    expect(authorizationUrl.searchParams.get("client_id")).toBe("pscale_app_123");
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(
      "https://mistle.example.com/callback",
    );
    expect(authorizationUrl.searchParams.get("state")).toBe("state_123");
    expect(authorizationUrl.searchParams.get("code_challenge")).toBe("challenge_123");
    expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorizationUrl.searchParams.has("scope")).toBe(false);
  });

  it("builds the expected authorization code exchange body", () => {
    expect(
      buildPlanetScaleAuthorizationCodeExchangeRequestBody({
        code: "code_123",
        redirectUrl: "https://mistle.example.com/callback",
        clientId: "pscale_app_123",
        clientSecret: "pscale_secret_456",
        pkceVerifier: "verifier_789",
      }).toString(),
    ).toBe(
      "grant_type=authorization_code&code=code_123&redirect_uri=https%3A%2F%2Fmistle.example.com%2Fcallback&client_id=pscale_app_123&client_secret=pscale_secret_456&code_verifier=verifier_789",
    );
  });

  it("builds the expected refresh body", () => {
    expect(
      buildPlanetScaleRefreshRequestBody({
        refreshToken: "refresh_123",
        clientId: "pscale_app_123",
        clientSecret: "pscale_secret_456",
      }).toString(),
    ).toBe(
      "grant_type=refresh_token&refresh_token=refresh_123&client_id=pscale_app_123&client_secret=pscale_secret_456",
    );
  });

  it("parses the dynamic client registration response", () => {
    expect(
      parsePlanetScaleDynamicClientRegistrationResponse({
        client_id: "pscale_app_123",
        client_secret: "pscale_secret_456",
        client_name: "Mistle PlanetScale MCP",
      }),
    ).toEqual({
      clientId: "pscale_app_123",
      clientSecret: "pscale_secret_456",
    });
  });

  it("requires an exact 201 status for dynamic client registration", () => {
    expect(() =>
      assertPlanetScaleDynamicClientRegistrationSucceeded({
        status: 200,
        body: '{"client_id":"pscale_app_123"}',
      }),
    ).toThrow(/dynamic client registration failed \(200\)/u);

    expect(() =>
      assertPlanetScaleDynamicClientRegistrationSucceeded({
        status: 201,
        body: '{"client_id":"pscale_app_123","client_secret":"pscale_secret_456"}',
      }),
    ).not.toThrow();
  });

  it("resolves the authorization code and surfaces callback errors", () => {
    expect(
      resolvePlanetScaleAuthorizationCodeOrThrow(
        new URLSearchParams({
          code: "code_123",
          state: "state_123",
        }),
      ),
    ).toBe("code_123");

    expect(() =>
      resolvePlanetScaleAuthorizationCodeOrThrow(
        new URLSearchParams({
          error: "access_denied",
          error_description: "user declined access",
        }),
      ),
    ).toThrow(
      "PlanetScale OAuth authorization failed with error 'access_denied': user declined access",
    );
  });

  it("derives completion output including the persisted client secret", () => {
    expect(
      resolvePlanetScaleCompleteGrantResult({
        providerState: {
          clientId: "pscale_app_123",
          clientSecret: "pscale_secret_456",
        },
        response: {
          access_token: "access_123",
          refresh_token: "refresh_456",
          expires_in: 3600,
          scope: "openid profile",
        },
        issuedAt: new Date("2026-04-11T00:00:00.000Z"),
      }),
    ).toEqual({
      connectionConfig: {
        client_id: "pscale_app_123",
      },
      accessToken: "access_123",
      accessTokenExpiresAt: "2026-04-11T01:00:00.000Z",
      refreshToken: "refresh_456",
      clientSecret: "pscale_secret_456",
      credentialMetadata: {
        scope: "openid profile",
      },
    });
  });

  it("derives refresh output with optional rotated refresh token", () => {
    expect(
      resolvePlanetScaleRefreshResult({
        response: {
          access_token: "access_789",
          refresh_token: "refresh_789",
          expires_in: 1800,
          scope: "openid profile",
        },
        issuedAt: new Date("2026-04-11T00:00:00.000Z"),
      }),
    ).toEqual({
      accessToken: "access_789",
      accessTokenExpiresAt: "2026-04-11T00:30:00.000Z",
      refreshToken: "refresh_789",
      credentialMetadata: {
        scope: "openid profile",
      },
    });
  });

  it("classifies permanent and temporary refresh failures", () => {
    expect(
      classifyPlanetScaleRefreshFailure({
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
      classifyPlanetScaleRefreshFailure({
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
  });

  it("converts refresh transport failures into temporary classified errors", () => {
    const error = createPlanetScaleRefreshTransportFailure({
      error: new Error("network down"),
    });

    expect(error.classification).toBe("temporary");
    expect(error.message).toContain("network down");
  });
});
