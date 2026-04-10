import { describe, expect, it } from "vitest";

import {
  buildPlanetScaleAuthorizationCodeRequestBody,
  buildPlanetScaleAuthorizationUrl,
  buildPlanetScaleRefreshRequestBody,
  classifyPlanetScaleRefreshFailure,
  extractPlanetScaleOauthErrorCode,
  extractPlanetScaleOauthErrorDescription,
  parsePlanetScaleTokenResponse,
  resolveIsoTimestampFromExpiresIn,
} from "./oauth2-authorization-code.server.js";

describe("PlanetScale OAuth2 authorization code capability helpers", () => {
  it("builds the authorization URL with PKCE parameters", () => {
    const authorizationUrl = new URL(
      buildPlanetScaleAuthorizationUrl({
        clientId: "ps_client_123",
        redirectUrl: "https://control.example.com/callback",
        state: "state_123",
        pkce: {
          challenge: "challenge_123",
          challengeMethod: "S256",
        },
      }),
    );

    expect(authorizationUrl.origin + authorizationUrl.pathname).toBe(
      "https://auth.planetscale.com/oauth/authorize",
    );
    expect(authorizationUrl.searchParams.get("client_id")).toBe("ps_client_123");
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(
      "https://control.example.com/callback",
    );
    expect(authorizationUrl.searchParams.get("response_type")).toBe("code");
    expect(authorizationUrl.searchParams.get("state")).toBe("state_123");
    expect(authorizationUrl.searchParams.get("code_challenge")).toBe("challenge_123");
    expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("builds authorization-code and refresh request bodies", () => {
    expect(
      buildPlanetScaleAuthorizationCodeRequestBody({
        clientId: "ps_client_123",
        clientSecret: "ps_secret_123",
        authorizationCode: "code_123",
        redirectUrl: "https://control.example.com/callback",
        pkceVerifier: "verifier_123",
      }).toString(),
    ).toBe(
      "grant_type=authorization_code&client_id=ps_client_123&client_secret=ps_secret_123&code=code_123&redirect_uri=https%3A%2F%2Fcontrol.example.com%2Fcallback&code_verifier=verifier_123",
    );

    expect(
      buildPlanetScaleRefreshRequestBody({
        clientId: "ps_client_123",
        clientSecret: "ps_secret_123",
        refreshToken: "refresh_123",
      }).toString(),
    ).toBe(
      "grant_type=refresh_token&client_id=ps_client_123&client_secret=ps_secret_123&refresh_token=refresh_123",
    );
  });

  it("parses token responses and derives ISO expiries", () => {
    expect(
      parsePlanetScaleTokenResponse({
        access_token: "access_123",
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: "refresh_123",
        scope: "read_user",
      }),
    ).toEqual({
      accessToken: "access_123",
      expiresIn: 3600,
      refreshToken: "refresh_123",
      scope: "read_user",
    });

    expect(
      resolveIsoTimestampFromExpiresIn({
        expiresIn: 3600,
        nowMs: Date.parse("2026-04-11T00:00:00.000Z"),
      }),
    ).toBe("2026-04-11T01:00:00.000Z");
  });

  it("extracts provider error details and classifies refresh failures", () => {
    const body = JSON.stringify({
      error: "invalid_grant",
      error_description: "token has been revoked",
    });

    expect(extractPlanetScaleOauthErrorCode(body)).toBe("invalid_grant");
    expect(extractPlanetScaleOauthErrorDescription(body)).toBe("token has been revoked");
    expect(
      classifyPlanetScaleRefreshFailure({
        status: 400,
        body,
      }),
    ).toEqual({
      classification: "permanent",
      code: "invalid_grant",
      message: "token has been revoked",
    });

    expect(
      classifyPlanetScaleRefreshFailure({
        status: 503,
        body: JSON.stringify({
          error_description: "temporary outage",
        }),
      }),
    ).toEqual({
      classification: "temporary",
      message: "temporary outage",
    });
  });
});
