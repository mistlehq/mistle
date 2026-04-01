import { createSecretKey } from "node:crypto";

import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";

import {
  mintPublishedTargetShareToken,
  PublishedTargetShareTokenError,
  PublishedTargetShareTokenErrorCode,
  type PublishedTargetShareTokenConfig,
  verifyPublishedTargetShareToken,
} from "./published-target-share-token.js";

const defaultConfig: PublishedTargetShareTokenConfig = {
  tokenAudience: "data-plane-gateway",
  tokenIssuer: "control-plane-api",
  tokenSecret: "published-target-share-secret",
};

async function expectPublishedTargetShareTokenError(
  promise: Promise<unknown>,
): Promise<PublishedTargetShareTokenError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof PublishedTargetShareTokenError) {
      return error;
    }

    throw error;
  }

  throw new Error("Expected promise to reject with PublishedTargetShareTokenError.");
}

describe("@mistle/published-target-auth published target share token", () => {
  it("mints and verifies a share token", async () => {
    const token = await mintPublishedTargetShareToken({
      config: defaultConfig,
      host: "p-5173--sbi-roundtrip-001.mistle.localhost",
      jti: "jti_share_roundtrip_001",
      sandboxInstanceId: "sbi_roundtrip_001",
      shareId: "shr_123",
      targetId: "5173",
      targetKind: "port",
      ttlSeconds: 60,
    });

    const verifiedToken = await verifyPublishedTargetShareToken({
      config: defaultConfig,
      token,
    });

    expect(verifiedToken).toMatchObject({
      host: "p-5173--sbi-roundtrip-001.mistle.localhost",
      jti: "jti_share_roundtrip_001",
      sandboxInstanceId: "sbi_roundtrip_001",
      shareId: "shr_123",
      targetId: "5173",
      targetKind: "port",
    });
    expect(verifiedToken.expiresAtEpochSeconds).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("rejects mint when targetId is missing", async () => {
    const error = await expectPublishedTargetShareTokenError(
      mintPublishedTargetShareToken({
        config: defaultConfig,
        host: "p-5173--sbi-roundtrip-001.mistle.localhost",
        jti: "jti_share_missing_target_001",
        sandboxInstanceId: "sbi_roundtrip_001",
        targetId: "   ",
        targetKind: "port",
        ttlSeconds: 60,
      }),
    );

    expect(error.code).toBe(PublishedTargetShareTokenErrorCode.TARGET_ID_REQUIRED);
  });

  it("rejects verify when token is expired", async () => {
    const token = await new SignJWT({
      host: "p-5173--sbi-roundtrip-001.mistle.localhost",
      sandboxInstanceId: "sbi_roundtrip_001",
      targetId: "5173",
      targetKind: "port",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setJti("jti_share_expired_001")
      .setIssuer(defaultConfig.tokenIssuer)
      .setAudience(defaultConfig.tokenAudience)
      .setIssuedAt(1)
      .setExpirationTime(2)
      .sign(createSecretKey(new TextEncoder().encode(defaultConfig.tokenSecret)));

    const error = await expectPublishedTargetShareTokenError(
      verifyPublishedTargetShareToken({
        config: defaultConfig,
        token,
      }),
    );

    expect(error.code).toBe(PublishedTargetShareTokenErrorCode.TOKEN_EXPIRED);
  });
});
