import { createSecretKey } from "node:crypto";

import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";

import {
  TunnelExchangeTokenError,
  TunnelExchangeTokenErrorCode,
  type TunnelExchangeTokenConfig,
  mintTunnelExchangeToken,
  verifyTunnelExchangeToken,
} from "./tunnel-exchange-token.js";

const defaultConfig: TunnelExchangeTokenConfig = {
  tokenSecret: "integration-tunnel-exchange-token-secret",
  tokenIssuer: "data-plane-worker",
  tokenAudience: "data-plane-gateway",
};

async function expectTunnelExchangeTokenError(
  promise: Promise<unknown>,
): Promise<TunnelExchangeTokenError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof TunnelExchangeTokenError) {
      return error;
    }

    throw error;
  }

  throw new Error("Expected promise to reject with TunnelExchangeTokenError.");
}

describe("@mistle/gateway-tunnel-auth tunnel exchange token", () => {
  it("mints and verifies tunnel exchange token with the same config", async () => {
    const token = await mintTunnelExchangeToken({
      config: defaultConfig,
      jti: "jti_roundtrip_001",
      sandboxInstanceId: "sbi_roundtrip_001",
      ttlSeconds: 3600,
    });

    const verifiedToken = await verifyTunnelExchangeToken({
      config: defaultConfig,
      token,
    });

    expect(verifiedToken).toEqual({
      jti: "jti_roundtrip_001",
      sandboxInstanceId: "sbi_roundtrip_001",
    });
  });

  it("rejects mint when jti claim is empty", async () => {
    const error = await expectTunnelExchangeTokenError(
      mintTunnelExchangeToken({
        config: defaultConfig,
        jti: "   ",
        sandboxInstanceId: "sbi_missing_jti_001",
        ttlSeconds: 3600,
      }),
    );

    expect(error.code).toBe(TunnelExchangeTokenErrorCode.JTI_REQUIRED);
  });

  it("rejects mint when sandboxInstanceId claim is empty", async () => {
    const error = await expectTunnelExchangeTokenError(
      mintTunnelExchangeToken({
        config: defaultConfig,
        jti: "jti_missing_sandbox_instance_001",
        sandboxInstanceId: "   ",
        ttlSeconds: 3600,
      }),
    );

    expect(error.code).toBe(TunnelExchangeTokenErrorCode.SANDBOX_INSTANCE_ID_REQUIRED);
  });

  it("rejects verify when audience does not match", async () => {
    const token = await mintTunnelExchangeToken({
      config: defaultConfig,
      jti: "jti_bad_aud_001",
      sandboxInstanceId: "sbi_bad_aud_001",
      ttlSeconds: 3600,
    });

    const error = await expectTunnelExchangeTokenError(
      verifyTunnelExchangeToken({
        config: {
          ...defaultConfig,
          tokenAudience: "data-plane-gateway-mismatch",
        },
        token,
      }),
    );

    expect(error.code).toBe(TunnelExchangeTokenErrorCode.TOKEN_INVALID_AUDIENCE);
  });

  it("rejects verify when token is expired", async () => {
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setJti("jti_expired_001")
      .setIssuer(defaultConfig.tokenIssuer)
      .setAudience(defaultConfig.tokenAudience)
      .setIssuedAt(1)
      .setExpirationTime(2)
      .sign(createSecretKey(new TextEncoder().encode(defaultConfig.tokenSecret)));

    const error = await expectTunnelExchangeTokenError(
      verifyTunnelExchangeToken({
        config: defaultConfig,
        token,
      }),
    );

    expect(error.code).toBe(TunnelExchangeTokenErrorCode.TOKEN_EXPIRED);
  });

  it("rejects verify when sandboxInstanceId claim is missing", async () => {
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setJti("jti_missing_sandbox_instance_001")
      .setIssuer(defaultConfig.tokenIssuer)
      .setAudience(defaultConfig.tokenAudience)
      .setIssuedAt()
      .setExpirationTime("2m")
      .sign(createSecretKey(new TextEncoder().encode(defaultConfig.tokenSecret)));

    const error = await expectTunnelExchangeTokenError(
      verifyTunnelExchangeToken({
        config: defaultConfig,
        token,
      }),
    );

    expect(error.code).toBe(TunnelExchangeTokenErrorCode.SANDBOX_INSTANCE_ID_REQUIRED);
  });
});
