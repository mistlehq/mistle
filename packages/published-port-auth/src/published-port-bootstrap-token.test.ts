import { createSecretKey } from "node:crypto";

import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";

import {
  mintPublishedPortBootstrapToken,
  PublishedPortBootstrapTokenError,
  PublishedPortBootstrapTokenErrorCode,
  verifyPublishedPortBootstrapToken,
  type PublishedPortBootstrapTokenConfig,
} from "./published-port-bootstrap-token.js";

const defaultConfig: PublishedPortBootstrapTokenConfig = {
  tokenSecret: "integration-published-port-bootstrap-secret",
  tokenIssuer: "control-plane-api",
  tokenAudience: "data-plane-gateway",
};

async function expectBootstrapTokenError(
  promise: Promise<unknown>,
): Promise<PublishedPortBootstrapTokenError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof PublishedPortBootstrapTokenError) {
      return error;
    }
    throw error;
  }

  throw new Error("Expected promise to reject with PublishedPortBootstrapTokenError.");
}

describe("@mistle/published-port-auth published port bootstrap token", () => {
  it("mints and verifies a published port bootstrap token", async () => {
    const token = await mintPublishedPortBootstrapToken({
      config: defaultConfig,
      jti: "jti_roundtrip_001",
      sandboxInstanceId: "sbi_roundtrip_001",
      port: 5173,
      host: "p-5173--onyxg4ddn5zgk4tbmjqweyi.mistle.example.test",
      ttlSeconds: 60,
    });

    const verified = await verifyPublishedPortBootstrapToken({
      config: defaultConfig,
      token,
    });

    expect(verified.jti).toBe("jti_roundtrip_001");
    expect(verified.sandboxInstanceId).toBe("sbi_roundtrip_001");
    expect(verified.port).toBe(5173);
    expect(verified.host).toBe("p-5173--onyxg4ddn5zgk4tbmjqweyi.mistle.example.test");
  });

  it("rejects an expired token", async () => {
    const token = await new SignJWT({
      sandboxInstanceId: "sbi_roundtrip_001",
      port: 5173,
      host: "p-5173--onyxg4ddn5zgk4tbmjqweyi.mistle.example.test",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setJti("expired_jti")
      .setIssuer(defaultConfig.tokenIssuer)
      .setAudience(defaultConfig.tokenAudience)
      .setIssuedAt(Math.floor(Date.now() / 1000) - 120)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(createSecretKey(new TextEncoder().encode(defaultConfig.tokenSecret)));

    const error = await expectBootstrapTokenError(
      verifyPublishedPortBootstrapToken({
        config: defaultConfig,
        token,
      }),
    );

    expect(error.code).toBe(PublishedPortBootstrapTokenErrorCode.TOKEN_EXPIRED);
  });

  it("rejects mint when port is invalid", async () => {
    const error = await expectBootstrapTokenError(
      mintPublishedPortBootstrapToken({
        config: defaultConfig,
        jti: "jti_invalid_port",
        sandboxInstanceId: "sbi_roundtrip_001",
        port: 0,
        host: "p-5173--onyxg4ddn5zgk4tbmjqweyi.mistle.example.test",
        ttlSeconds: 60,
      }),
    );

    expect(error.code).toBe(PublishedPortBootstrapTokenErrorCode.PORT_INVALID);
  });
});
