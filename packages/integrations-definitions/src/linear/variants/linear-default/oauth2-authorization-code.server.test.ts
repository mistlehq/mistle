import { describe, expect, it } from "vitest";

import {
  buildLinearAuthorizationCodeExchangeRequestBody,
  buildLinearAuthorizationUrl,
  buildLinearRefreshRequestBody,
  resolveLinearAuthorizationCodeOrThrow,
  resolveLinearAccessTokenExpiresAt,
} from "./oauth2-authorization-code.server.js";

describe("Linear OAuth authorization code helpers", () => {
  it("builds a Linear OAuth authorization URL for user actor access", () => {
    const authorizationUrl = new URL(
      buildLinearAuthorizationUrl({
        clientId: "linear_client_123",
        redirectUrl: "https://mistle.example.com/callback",
        state: "state_123",
        pkceChallenge: "challenge_456",
      }),
    );

    expect(authorizationUrl.origin).toBe("https://linear.app");
    expect(authorizationUrl.pathname).toBe("/oauth/authorize");
    expect(authorizationUrl.searchParams.get("response_type")).toBe("code");
    expect(authorizationUrl.searchParams.get("client_id")).toBe("linear_client_123");
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(
      "https://mistle.example.com/callback",
    );
    expect(authorizationUrl.searchParams.get("state")).toBe("state_123");
    expect(authorizationUrl.searchParams.get("scope")).toBe("read,write");
    expect(authorizationUrl.searchParams.get("actor")).toBe("user");
    expect(authorizationUrl.searchParams.get("code_challenge")).toBe("challenge_456");
    expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("builds token exchange and refresh request bodies", () => {
    expect(
      buildLinearAuthorizationCodeExchangeRequestBody({
        code: "code_123",
        redirectUrl: "https://mistle.example.com/callback",
        clientId: "linear_client_123",
        clientSecret: "linear_secret_456",
        pkceVerifier: "verifier_789",
      }).toString(),
    ).toBe(
      "grant_type=authorization_code&code=code_123&redirect_uri=https%3A%2F%2Fmistle.example.com%2Fcallback&client_id=linear_client_123&client_secret=linear_secret_456&code_verifier=verifier_789",
    );

    expect(
      buildLinearRefreshRequestBody({
        refreshToken: "refresh_123",
        clientId: "linear_client_123",
        clientSecret: "linear_secret_456",
      }).toString(),
    ).toBe(
      "grant_type=refresh_token&refresh_token=refresh_123&client_id=linear_client_123&client_secret=linear_secret_456",
    );
  });

  it("resolves callback authorization codes and reports provider errors", () => {
    expect(resolveLinearAuthorizationCodeOrThrow(new URLSearchParams("code=code_123"))).toBe(
      "code_123",
    );

    expect(() =>
      resolveLinearAuthorizationCodeOrThrow(
        new URLSearchParams("error=access_denied&error_description=Nope"),
      ),
    ).toThrow("Linear OAuth authorization failed with error 'access_denied': Nope");

    expect(() => resolveLinearAuthorizationCodeOrThrow(new URLSearchParams())).toThrow(
      "Linear OAuth callback query must include `code`.",
    );
  });

  it("resolves access token expiry timestamps from Linear expires_in values", () => {
    expect(
      resolveLinearAccessTokenExpiresAt({
        issuedAt: new Date("2026-06-27T00:00:00.000Z"),
        expiresIn: "7200",
      }),
    ).toBe("2026-06-27T02:00:00.000Z");
  });
});
