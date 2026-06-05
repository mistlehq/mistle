import { describe, expect, it } from "vitest";

import {
  classifyOpenAiRefreshFailure,
  extractOpenAiRefreshFailureCode,
  parseJwtClaimsOrThrow,
  parseOpenAiRefreshResponse,
  parseOpenAiTokenExchangeResponse,
  resolveOpenAiAccessTokenExpiresAt,
  resolveOpenAiDeviceAuthorizationCompletionFromTokens,
} from "./device-authorization.js";

function encodeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" }), "utf8").toString(
    "base64url",
  );
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");

  return `${header}.${encodedPayload}.`;
}

describe("OpenAI device authorization", () => {
  it("parses jwt claims from a token payload", () => {
    const token = encodeJwt({
      chatgpt_account_id: "acct_123",
      email: "user@example.com",
    });

    expect(parseJwtClaimsOrThrow(token)).toEqual({
      chatgpt_account_id: "acct_123",
      email: "user@example.com",
    });
  });

  it("resolves access-token expiry from expires_in before JWT claims", () => {
    const accessToken = encodeJwt({
      exp: 4_102_444_799,
    });

    expect(
      resolveOpenAiAccessTokenExpiresAt({
        accessToken,
        expiresIn: 120,
        nowMs: Date.parse("2026-06-05T12:00:00.000Z"),
      }),
    ).toBe("2026-06-05T12:02:00.000Z");
  });

  it("resolves access-token expiry from JWT exp when expires_in is missing", () => {
    const accessToken = encodeJwt({
      exp: 1_801_401_600,
    });

    expect(
      resolveOpenAiAccessTokenExpiresAt({
        accessToken,
        nowMs: Date.parse("2026-06-05T12:00:00.000Z"),
      }),
    ).toBe("2027-01-31T13:20:00.000Z");
  });

  it("leaves access-token expiry unknown for opaque tokens and JWTs without exp", () => {
    expect(
      resolveOpenAiAccessTokenExpiresAt({
        accessToken: "opaque-access-token",
        nowMs: Date.parse("2026-06-05T12:00:00.000Z"),
      }),
    ).toBeUndefined();

    expect(
      resolveOpenAiAccessTokenExpiresAt({
        accessToken: encodeJwt({
          sub: "user_123",
        }),
        nowMs: Date.parse("2026-06-05T12:00:00.000Z"),
      }),
    ).toBeUndefined();
  });

  it("derives connection completion output from exchanged tokens", () => {
    const idToken = encodeJwt({
      chatgpt_account_id: "acct_123",
      chatgpt_plan_type: "pro",
      email: "user@example.com",
    });
    const accessToken = "opaque-access-token";
    const refreshToken = "opaque-refresh-token";

    expect(
      resolveOpenAiDeviceAuthorizationCompletionFromTokens({
        idToken,
        accessToken,
        refreshToken,
        accessTokenExpiresAt: "2099-12-31T23:55:00.000Z",
      }),
    ).toEqual({
      status: "completed",
      externalSubjectId: "user@example.com",
      connectionConfig: {
        connection_method: "chatgpt-device-code",
        auth_mode: "chatgpt",
        chatgpt_account_id: "acct_123",
        chatgpt_plan_type: "pro",
      },
      accessToken,
      accessTokenExpiresAt: "2099-12-31T23:55:00.000Z",
      refreshToken,
    });
  });

  it("derives connection completion output from nested OpenAI auth claims", () => {
    const idToken = encodeJwt({
      "https://api.openai.com/auth": {
        chatgpt_account_id: "acct_nested",
        chatgpt_plan_type: "business",
      },
      email: "nested@example.com",
    });

    expect(
      resolveOpenAiDeviceAuthorizationCompletionFromTokens({
        idToken,
        accessToken: "opaque-access-token",
        refreshToken: "opaque-refresh-token",
      }),
    ).toEqual({
      status: "completed",
      externalSubjectId: "nested@example.com",
      connectionConfig: {
        connection_method: "chatgpt-device-code",
        auth_mode: "chatgpt",
        chatgpt_account_id: "acct_nested",
        chatgpt_plan_type: "business",
      },
      accessToken: "opaque-access-token",
      refreshToken: "opaque-refresh-token",
    });
  });

  it("allows completion when id_token is missing chatgpt_account_id", () => {
    expect(
      resolveOpenAiDeviceAuthorizationCompletionFromTokens({
        idToken: encodeJwt({
          email: "user@example.com",
        }),
        accessToken: "opaque-access-token",
        refreshToken: "opaque-refresh-token",
      }),
    ).toEqual({
      status: "completed",
      externalSubjectId: "user@example.com",
      connectionConfig: {
        connection_method: "chatgpt-device-code",
        auth_mode: "chatgpt",
      },
      accessToken: "opaque-access-token",
      refreshToken: "opaque-refresh-token",
    });
  });

  it("extracts refresh-token failure codes from string and object error payloads", () => {
    expect(
      extractOpenAiRefreshFailureCode(
        JSON.stringify({
          error: "refresh_token_expired",
        }),
      ),
    ).toBe("refresh_token_expired");

    expect(
      extractOpenAiRefreshFailureCode(
        JSON.stringify({
          error: {
            code: "refresh_token_invalidated",
          },
        }),
      ),
    ).toBe("refresh_token_invalidated");
  });

  it("classifies permanent and temporary refresh failures", () => {
    expect(
      classifyOpenAiRefreshFailure({
        status: 401,
        body: JSON.stringify({
          error: "refresh_token_reused",
          error_description: "refresh token already used",
        }),
      }),
    ).toEqual({
      classification: "permanent",
      code: "refresh_token_reused",
      message: "refresh token already used",
    });

    expect(
      classifyOpenAiRefreshFailure({
        status: 500,
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

  it("accepts additional oauth fields on the token exchange response", () => {
    expect(
      parseOpenAiTokenExchangeResponse({
        id_token: "id-token",
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_in: 3600,
        scope: "openid profile offline_access",
        token_type: "Bearer",
      }),
    ).toEqual({
      idToken: "id-token",
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresIn: 3600,
    });
  });

  it("accepts additional oauth fields on the refresh response", () => {
    expect(
      parseOpenAiRefreshResponse({
        id_token: "next-id-token",
        access_token: "next-access-token",
        refresh_token: "next-refresh-token",
        expires_in: 3600,
        scope: "openid profile offline_access",
        token_type: "Bearer",
      }),
    ).toMatchObject({
      id_token: "next-id-token",
      access_token: "next-access-token",
      refresh_token: "next-refresh-token",
    });
  });
});
