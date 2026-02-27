import { createSecretKey } from "node:crypto";

import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";

import {
  BootstrapTokenError,
  BootstrapTokenErrorCode,
  mintBootstrapToken,
  verifyBootstrapToken,
  type BootstrapTokenConfig,
} from "./bootstrap-token.js";

const defaultConfig: BootstrapTokenConfig = {
  bootstrapTokenSecret: "integration-bootstrap-token-secret",
  tokenIssuer: "data-plane-worker",
  tokenAudience: "data-plane-gateway",
};

async function expectBootstrapTokenError(promise: Promise<unknown>): Promise<BootstrapTokenError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof BootstrapTokenError) {
      return error;
    }

    throw error;
  }

  throw new Error("Expected promise to reject with BootstrapTokenError.");
}

describe("@mistle/tunnel-auth bootstrap token", () => {
  it("mints and verifies bootstrap token with the same config", async () => {
    const token = await mintBootstrapToken({
      config: defaultConfig,
      jti: "jti_roundtrip_001",
      ttlSeconds: 60,
    });

    const verifiedToken = await verifyBootstrapToken({
      config: defaultConfig,
      token,
    });

    expect(verifiedToken).toEqual({
      jti: "jti_roundtrip_001",
    });
  });

  it("rejects mint when jti claim is empty", async () => {
    const error = await expectBootstrapTokenError(
      mintBootstrapToken({
        config: defaultConfig,
        jti: "   ",
        ttlSeconds: 60,
      }),
    );

    expect(error.code).toBe(BootstrapTokenErrorCode.JTI_REQUIRED);
  });

  it("rejects mint when ttlSeconds is invalid", async () => {
    const error = await expectBootstrapTokenError(
      mintBootstrapToken({
        config: defaultConfig,
        jti: "jti_invalid_ttl_001",
        ttlSeconds: 0,
      }),
    );

    expect(error.code).toBe(BootstrapTokenErrorCode.INVALID_TTL_SECONDS);
  });

  it("rejects verify when audience does not match", async () => {
    const token = await mintBootstrapToken({
      config: defaultConfig,
      jti: "jti_bad_aud_001",
      ttlSeconds: 60,
    });
    const error = await expectBootstrapTokenError(
      verifyBootstrapToken({
        config: {
          ...defaultConfig,
          tokenAudience: "data-plane-gateway-mismatch",
        },
        token,
      }),
    );

    expect(error.code).toBe(BootstrapTokenErrorCode.TOKEN_INVALID_AUDIENCE);
  });

  it("rejects verify when token is expired", async () => {
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setJti("jti_expired_001")
      .setIssuer(defaultConfig.tokenIssuer)
      .setAudience(defaultConfig.tokenAudience)
      .setIssuedAt(1)
      .setExpirationTime(2)
      .sign(createSecretKey(new TextEncoder().encode(defaultConfig.bootstrapTokenSecret)));

    const error = await expectBootstrapTokenError(
      verifyBootstrapToken({
        config: defaultConfig,
        token,
      }),
    );

    expect(error.code).toBe(BootstrapTokenErrorCode.TOKEN_EXPIRED);
  });

  it("rejects verify when jti claim is missing", async () => {
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(defaultConfig.tokenIssuer)
      .setAudience(defaultConfig.tokenAudience)
      .setIssuedAt()
      .setExpirationTime("2m")
      .sign(createSecretKey(new TextEncoder().encode(defaultConfig.bootstrapTokenSecret)));

    const error = await expectBootstrapTokenError(
      verifyBootstrapToken({
        config: defaultConfig,
        token,
      }),
    );

    expect(error.code).toBe(BootstrapTokenErrorCode.JTI_REQUIRED);
  });
});
