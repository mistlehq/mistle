import { createSecretKey } from "node:crypto";

import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";

import {
  ConnectionTokenError,
  ConnectionTokenErrorCode,
  mintConnectionToken,
  verifyConnectionToken,
  type ConnectionTokenConfig,
} from "./connection-token.js";

const defaultConfig: ConnectionTokenConfig = {
  connectionTokenSecret: "integration-connection-token-secret",
  tokenIssuer: "control-plane-api",
  tokenAudience: "data-plane-gateway",
};

async function expectConnectionTokenError(
  promise: Promise<unknown>,
): Promise<ConnectionTokenError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ConnectionTokenError) {
      return error;
    }

    throw error;
  }

  throw new Error("Expected promise to reject with ConnectionTokenError.");
}

describe("@mistle/gateway-connection-auth connection token", () => {
  it("mints and verifies connection token with the same config", async () => {
    const token = await mintConnectionToken({
      config: defaultConfig,
      jti: "jti_roundtrip_001",
      sandboxInstanceId: "sbi_roundtrip_001",
      ttlSeconds: 60,
    });

    const verifiedToken = await verifyConnectionToken({
      config: defaultConfig,
      token,
    });

    expect(verifiedToken).toEqual({
      jti: "jti_roundtrip_001",
      sandboxInstanceId: "sbi_roundtrip_001",
    });
  });

  it("rejects mint when jti claim is empty", async () => {
    const error = await expectConnectionTokenError(
      mintConnectionToken({
        config: defaultConfig,
        jti: "   ",
        sandboxInstanceId: "sbi_missing_jti_001",
        ttlSeconds: 60,
      }),
    );

    expect(error.code).toBe(ConnectionTokenErrorCode.JTI_REQUIRED);
  });

  it("rejects mint when sandboxInstanceId claim is empty", async () => {
    const error = await expectConnectionTokenError(
      mintConnectionToken({
        config: defaultConfig,
        jti: "jti_missing_sandbox_instance_001",
        sandboxInstanceId: "   ",
        ttlSeconds: 60,
      }),
    );

    expect(error.code).toBe(ConnectionTokenErrorCode.SANDBOX_INSTANCE_ID_REQUIRED);
  });

  it("rejects mint when ttlSeconds is invalid", async () => {
    const error = await expectConnectionTokenError(
      mintConnectionToken({
        config: defaultConfig,
        jti: "jti_invalid_ttl_001",
        sandboxInstanceId: "sbi_invalid_ttl_001",
        ttlSeconds: 0,
      }),
    );

    expect(error.code).toBe(ConnectionTokenErrorCode.INVALID_TTL_SECONDS);
  });

  it("rejects verify when audience does not match", async () => {
    const token = await mintConnectionToken({
      config: defaultConfig,
      jti: "jti_bad_aud_001",
      sandboxInstanceId: "sbi_bad_aud_001",
      ttlSeconds: 60,
    });
    const error = await expectConnectionTokenError(
      verifyConnectionToken({
        config: {
          ...defaultConfig,
          tokenAudience: "data-plane-gateway-mismatch",
        },
        token,
      }),
    );

    expect(error.code).toBe(ConnectionTokenErrorCode.TOKEN_INVALID_AUDIENCE);
  });

  it("rejects verify when token is expired", async () => {
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setJti("jti_expired_001")
      .setIssuer(defaultConfig.tokenIssuer)
      .setAudience(defaultConfig.tokenAudience)
      .setIssuedAt(1)
      .setExpirationTime(2)
      .sign(createSecretKey(new TextEncoder().encode(defaultConfig.connectionTokenSecret)));

    const error = await expectConnectionTokenError(
      verifyConnectionToken({
        config: defaultConfig,
        token,
      }),
    );

    expect(error.code).toBe(ConnectionTokenErrorCode.TOKEN_EXPIRED);
  });

  it("rejects verify when jti claim is missing", async () => {
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(defaultConfig.tokenIssuer)
      .setAudience(defaultConfig.tokenAudience)
      .setIssuedAt()
      .setExpirationTime("2m")
      .sign(createSecretKey(new TextEncoder().encode(defaultConfig.connectionTokenSecret)));

    const error = await expectConnectionTokenError(
      verifyConnectionToken({
        config: defaultConfig,
        token,
      }),
    );

    expect(error.code).toBe(ConnectionTokenErrorCode.JTI_REQUIRED);
  });

  it("rejects verify when sandboxInstanceId claim is missing", async () => {
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setJti("jti_missing_sandbox_instance_002")
      .setIssuer(defaultConfig.tokenIssuer)
      .setAudience(defaultConfig.tokenAudience)
      .setIssuedAt()
      .setExpirationTime("2m")
      .sign(createSecretKey(new TextEncoder().encode(defaultConfig.connectionTokenSecret)));

    const error = await expectConnectionTokenError(
      verifyConnectionToken({
        config: defaultConfig,
        token,
      }),
    );

    expect(error.code).toBe(ConnectionTokenErrorCode.SANDBOX_INSTANCE_ID_REQUIRED);
  });
});
