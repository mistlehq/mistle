import { createSecretKey } from "node:crypto";

import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";

import {
  mintPortAccessBootstrapToken,
  PortAccessBootstrapTokenError,
  PortAccessBootstrapTokenErrorCode,
  verifyPortAccessBootstrapToken,
  type PortAccessBootstrapTokenConfig,
} from "./port-access-bootstrap-token.js";

const defaultConfig: PortAccessBootstrapTokenConfig = {
  tokenSecret: "integration-port-access-token-secret",
  tokenIssuer: "control-plane-api",
  tokenAudience: "data-plane-gateway",
};
const RoundtripHost = "p-5173--onrgsx3sn52w4zduojuxaxzqgayq.mistle.localhost";

async function expectPortAccessBootstrapTokenError(
  promise: Promise<unknown>,
): Promise<PortAccessBootstrapTokenError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof PortAccessBootstrapTokenError) {
      return error;
    }

    throw error;
  }

  throw new Error("Expected promise to reject with PortAccessBootstrapTokenError.");
}

describe("@mistle/port-access-auth bootstrap token", () => {
  it("mints and verifies a bootstrap token", async () => {
    const token = await mintPortAccessBootstrapToken({
      config: defaultConfig,
      sandboxInstanceId: "sbi_roundtrip_001",
      port: 5173,
      host: RoundtripHost,
      ttlSeconds: 60,
    });

    await expect(
      verifyPortAccessBootstrapToken({
        config: defaultConfig,
        token,
      }),
    ).resolves.toEqual({
      sandboxInstanceId: "sbi_roundtrip_001",
      port: 5173,
      host: RoundtripHost,
    });
  });

  it("rejects invalid ttlSeconds during mint", async () => {
    const error = await expectPortAccessBootstrapTokenError(
      mintPortAccessBootstrapToken({
        config: defaultConfig,
        sandboxInstanceId: "sbi_invalid_ttl_001",
        port: 5173,
        host: RoundtripHost,
        ttlSeconds: 0,
      }),
    );

    expect(error.code).toBe(PortAccessBootstrapTokenErrorCode.INVALID_TTL_SECONDS);
  });

  it("rejects mint when tokenSecret is empty", async () => {
    const error = await expectPortAccessBootstrapTokenError(
      mintPortAccessBootstrapToken({
        config: {
          ...defaultConfig,
          tokenSecret: "   ",
        },
        sandboxInstanceId: "sbi_missing_secret_001",
        port: 5173,
        host: RoundtripHost,
        ttlSeconds: 60,
      }),
    );

    expect(error.code).toBe(PortAccessBootstrapTokenErrorCode.TOKEN_SECRET_REQUIRED);
  });

  it("rejects verify when tokenAudience is empty", async () => {
    const token = await mintPortAccessBootstrapToken({
      config: defaultConfig,
      sandboxInstanceId: "sbi_missing_audience_001",
      port: 5173,
      host: RoundtripHost,
      ttlSeconds: 60,
    });

    const error = await expectPortAccessBootstrapTokenError(
      verifyPortAccessBootstrapToken({
        config: {
          ...defaultConfig,
          tokenAudience: "   ",
        },
        token,
      }),
    );

    expect(error.code).toBe(PortAccessBootstrapTokenErrorCode.TOKEN_AUDIENCE_REQUIRED);
  });

  it("rejects verify when tokenIssuer is empty", async () => {
    const token = await mintPortAccessBootstrapToken({
      config: defaultConfig,
      sandboxInstanceId: "sbi_missing_issuer_001",
      port: 5173,
      host: RoundtripHost,
      ttlSeconds: 60,
    });

    const error = await expectPortAccessBootstrapTokenError(
      verifyPortAccessBootstrapToken({
        config: {
          ...defaultConfig,
          tokenIssuer: "   ",
        },
        token,
      }),
    );

    expect(error.code).toBe(PortAccessBootstrapTokenErrorCode.TOKEN_ISSUER_REQUIRED);
  });

  it("rejects verify when audience does not match", async () => {
    const token = await mintPortAccessBootstrapToken({
      config: defaultConfig,
      sandboxInstanceId: "sbi_bad_aud_001",
      port: 5173,
      host: RoundtripHost,
      ttlSeconds: 60,
    });

    const error = await expectPortAccessBootstrapTokenError(
      verifyPortAccessBootstrapToken({
        config: {
          ...defaultConfig,
          tokenAudience: "data-plane-gateway-mismatch",
        },
        token,
      }),
    );

    expect(error.code).toBe(PortAccessBootstrapTokenErrorCode.TOKEN_INVALID_AUDIENCE);
  });

  it("rejects verify when token is expired", async () => {
    const token = await new SignJWT({
      sandboxInstanceId: "sbi_expired_001",
      port: 5173,
      host: RoundtripHost,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(defaultConfig.tokenIssuer)
      .setAudience(defaultConfig.tokenAudience)
      .setIssuedAt(1)
      .setExpirationTime(2)
      .sign(createSecretKey(new TextEncoder().encode(defaultConfig.tokenSecret)));

    const error = await expectPortAccessBootstrapTokenError(
      verifyPortAccessBootstrapToken({
        config: defaultConfig,
        token,
      }),
    );

    expect(error.code).toBe(PortAccessBootstrapTokenErrorCode.TOKEN_EXPIRED);
  });

  it("rejects verify when host claim is missing", async () => {
    const token = await new SignJWT({
      sandboxInstanceId: "sbi_missing_host_001",
      port: 5173,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(defaultConfig.tokenIssuer)
      .setAudience(defaultConfig.tokenAudience)
      .setIssuedAt()
      .setExpirationTime("2m")
      .sign(createSecretKey(new TextEncoder().encode(defaultConfig.tokenSecret)));

    const error = await expectPortAccessBootstrapTokenError(
      verifyPortAccessBootstrapToken({
        config: defaultConfig,
        token,
      }),
    );

    expect(error.code).toBe(PortAccessBootstrapTokenErrorCode.HOST_REQUIRED);
  });

  it("rejects verify when port claim is invalid", async () => {
    const token = await new SignJWT({
      sandboxInstanceId: "sbi_missing_port_001",
      port: 0,
      host: RoundtripHost,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(defaultConfig.tokenIssuer)
      .setAudience(defaultConfig.tokenAudience)
      .setIssuedAt()
      .setExpirationTime("2m")
      .sign(createSecretKey(new TextEncoder().encode(defaultConfig.tokenSecret)));

    const error = await expectPortAccessBootstrapTokenError(
      verifyPortAccessBootstrapToken({
        config: defaultConfig,
        token,
      }),
    );

    expect(error.code).toBe(PortAccessBootstrapTokenErrorCode.PORT_INVALID);
  });
});
