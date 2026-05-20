import { createSecretKey } from "node:crypto";

import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";

import {
  McpTokenError,
  McpTokenErrorCode,
  mintMcpToken,
  verifyMcpToken,
  type McpTokenConfig,
} from "./mcp-token.js";

const TokenConfig: McpTokenConfig = {
  tokenSecret: "mcp-token-secret",
  tokenIssuer: "control-plane-api",
  tokenAudience: "mistle-mcp",
};

const JwtSecretEncoder = new TextEncoder();

function toSecretKey(secret: string): ReturnType<typeof createSecretKey> {
  return createSecretKey(JwtSecretEncoder.encode(secret));
}

describe("MCP token", () => {
  it("mints and verifies a short-lived MCP capability token for a sandbox instance", async () => {
    const minted = await mintMcpToken({
      config: TokenConfig,
      claims: {
        sub: "sbi_123",
        organizationId: "org_123",
        apiKeyId: "apk_123",
      },
      ttlSeconds: 300,
    });

    await expect(
      verifyMcpToken({
        config: TokenConfig,
        token: minted.token,
      }),
    ).resolves.toEqual({
      sub: "sbi_123",
      organizationId: "org_123",
      apiKeyId: "apk_123",
      expiresAt: minted.expiresAt,
    });
  });

  it("rejects tokens with the wrong audience", async () => {
    const minted = await mintMcpToken({
      config: TokenConfig,
      claims: {
        sub: "sbi_123",
        organizationId: "org_123",
        apiKeyId: "apk_123",
      },
      ttlSeconds: 300,
    });

    await expect(
      verifyMcpToken({
        config: {
          ...TokenConfig,
          tokenAudience: "other-audience",
        },
        token: minted.token,
      }),
    ).rejects.toMatchObject({
      code: McpTokenErrorCode.TOKEN_INVALID_AUDIENCE,
    } satisfies Partial<McpTokenError>);
  });

  it("rejects minting a token without an API key id claim", async () => {
    await expect(
      mintMcpToken({
        config: TokenConfig,
        claims: {
          sub: "sbi_123",
          organizationId: "org_123",
          apiKeyId: " ",
        },
        ttlSeconds: 300,
      }),
    ).rejects.toMatchObject({
      code: McpTokenErrorCode.API_KEY_ID_REQUIRED,
    } satisfies Partial<McpTokenError>);
  });

  it("rejects verifying a token without an API key id claim", async () => {
    const nowEpochSeconds = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({
      organizationId: "org_123",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("sbi_123")
      .setIssuer(TokenConfig.tokenIssuer)
      .setAudience(TokenConfig.tokenAudience)
      .setIssuedAt(nowEpochSeconds)
      .setNotBefore(nowEpochSeconds)
      .setExpirationTime(nowEpochSeconds + 300)
      .sign(toSecretKey(TokenConfig.tokenSecret));

    await expect(
      verifyMcpToken({
        config: TokenConfig,
        token,
      }),
    ).rejects.toMatchObject({
      code: McpTokenErrorCode.API_KEY_ID_REQUIRED,
    } satisfies Partial<McpTokenError>);
  });

  it("rejects invalid token TTLs before signing", async () => {
    await expect(
      mintMcpToken({
        config: TokenConfig,
        claims: {
          sub: "sbi_123",
          organizationId: "org_123",
          apiKeyId: "apk_123",
        },
        ttlSeconds: 0,
      }),
    ).rejects.toMatchObject({
      code: McpTokenErrorCode.INVALID_TTL_SECONDS,
    } satisfies Partial<McpTokenError>);
  });
});
