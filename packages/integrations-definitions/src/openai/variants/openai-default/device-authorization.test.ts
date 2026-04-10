import { describe, expect, it } from "vitest";

import {
  classifyOpenAiRefreshFailure,
  extractOpenAiRefreshFailureCode,
  parseJwtClaimsOrThrow,
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
      "https://api.openai.com/auth.chatgpt_account_id": "acct_123",
      email: "user@example.com",
    });

    expect(parseJwtClaimsOrThrow(token)).toEqual({
      "https://api.openai.com/auth.chatgpt_account_id": "acct_123",
      email: "user@example.com",
    });
  });

  it("derives connection completion output from exchanged tokens", () => {
    const idToken = encodeJwt({
      "https://api.openai.com/auth.chatgpt_account_id": "acct_123",
      "https://api.openai.com/auth.chatgpt_plan_type": "pro",
      email: "user@example.com",
      exp: 4_102_444_800,
    });
    const accessToken = encodeJwt({
      exp: 4_102_444_500,
    });
    const refreshToken = encodeJwt({
      exp: 4_102_445_000,
    });

    expect(
      resolveOpenAiDeviceAuthorizationCompletionFromTokens({
        idToken,
        accessToken,
        refreshToken,
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
      refreshTokenExpiresAt: "2100-01-01T00:03:20.000Z",
    });
  });

  it("throws when id_token is missing chatgpt_account_id", () => {
    expect(() =>
      resolveOpenAiDeviceAuthorizationCompletionFromTokens({
        idToken: encodeJwt({
          email: "user@example.com",
        }),
        accessToken: encodeJwt({}),
        refreshToken: encodeJwt({}),
      }),
    ).toThrow("OpenAI id_token is missing https://api.openai.com/auth.chatgpt_account_id.");
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
});
