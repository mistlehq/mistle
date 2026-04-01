import { createSecretKey } from "node:crypto";

import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";

import {
  mintPublishedTargetAccessToken,
  PublishedTargetAccessTokenError,
  PublishedTargetAccessTokenErrorCode,
  type PublishedTargetAccessTokenConfig,
  verifyPublishedTargetAccessToken,
} from "./published-target-access-token.js";

const defaultConfig: PublishedTargetAccessTokenConfig = {
  tokenAudience: "data-plane-gateway",
  tokenIssuer: "control-plane-api",
  tokenSecret: "published-target-access-secret",
};

async function expectPublishedTargetAccessTokenError(
  promise: Promise<unknown>,
): Promise<PublishedTargetAccessTokenError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof PublishedTargetAccessTokenError) {
      return error;
    }

    throw error;
  }

  throw new Error("Expected promise to reject with PublishedTargetAccessTokenError.");
}

describe("@mistle/published-target-auth published target access token", () => {
  it("mints and verifies an owned publish token", async () => {
    const token = await mintPublishedTargetAccessToken({
      config: defaultConfig,
      host: "p-5173--sbi-roundtrip-001.mistle.localhost",
      jti: "jti_publish_roundtrip_001",
      organizationId: "org_123",
      sandboxInstanceId: "sbi_roundtrip_001",
      targetId: "5173",
      targetKind: "port",
      ttlSeconds: 60,
      userId: "usr_123",
    });

    const verifiedToken = await verifyPublishedTargetAccessToken({
      config: defaultConfig,
      token,
    });

    expect(verifiedToken).toMatchObject({
      host: "p-5173--sbi-roundtrip-001.mistle.localhost",
      jti: "jti_publish_roundtrip_001",
      organizationId: "org_123",
      sandboxInstanceId: "sbi_roundtrip_001",
      targetId: "5173",
      targetKind: "port",
      userId: "usr_123",
    });
    expect(verifiedToken.expiresAtEpochSeconds).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("rejects mint when organizationId is missing", async () => {
    const error = await expectPublishedTargetAccessTokenError(
      mintPublishedTargetAccessToken({
        config: defaultConfig,
        host: "p-5173--sbi-roundtrip-001.mistle.localhost",
        jti: "jti_publish_missing_org_001",
        organizationId: "   ",
        sandboxInstanceId: "sbi_roundtrip_001",
        targetId: "5173",
        targetKind: "port",
        ttlSeconds: 60,
        userId: "usr_123",
      }),
    );

    expect(error.code).toBe(PublishedTargetAccessTokenErrorCode.ORGANIZATION_ID_REQUIRED);
  });

  it("rejects verify when token is expired", async () => {
    const token = await new SignJWT({
      host: "p-5173--sbi-roundtrip-001.mistle.localhost",
      organizationId: "org_123",
      sandboxInstanceId: "sbi_roundtrip_001",
      targetId: "5173",
      targetKind: "port",
      userId: "usr_123",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setJti("jti_publish_expired_001")
      .setIssuer(defaultConfig.tokenIssuer)
      .setAudience(defaultConfig.tokenAudience)
      .setIssuedAt(1)
      .setExpirationTime(2)
      .sign(createSecretKey(new TextEncoder().encode(defaultConfig.tokenSecret)));

    const error = await expectPublishedTargetAccessTokenError(
      verifyPublishedTargetAccessToken({
        config: defaultConfig,
        token,
      }),
    );

    expect(error.code).toBe(PublishedTargetAccessTokenErrorCode.TOKEN_EXPIRED);
  });

  it("rejects verify when target kind is not supported", async () => {
    const token = await new SignJWT({
      host: "p-5173--sbi-roundtrip-001.mistle.localhost",
      organizationId: "org_123",
      sandboxInstanceId: "sbi_roundtrip_001",
      targetId: "5173",
      targetKind: "app",
      userId: "usr_123",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setJti("jti_publish_bad_kind_001")
      .setIssuer(defaultConfig.tokenIssuer)
      .setAudience(defaultConfig.tokenAudience)
      .setIssuedAt()
      .setExpirationTime("2m")
      .sign(createSecretKey(new TextEncoder().encode(defaultConfig.tokenSecret)));

    const error = await expectPublishedTargetAccessTokenError(
      verifyPublishedTargetAccessToken({
        config: defaultConfig,
        token,
      }),
    );

    expect(error.code).toBe(PublishedTargetAccessTokenErrorCode.TARGET_KIND_INVALID);
  });
});
