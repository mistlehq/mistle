import { createSecretKey } from "node:crypto";

import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";

import {
  EgressGrantErrorCode,
  type EgressGrantClaims,
  mintEgressGrant,
  verifyEgressGrant,
} from "./index.js";

const defaultConfig = {
  tokenSecret: "integration-egress-grant-secret",
  tokenIssuer: "data-plane-worker",
  tokenAudience: "tokenizer-proxy",
};

const defaultClaims: EgressGrantClaims = {
  sub: "sbi_123",
  jti: "egress_rule_openai",
  bindingId: "ibd_openai",
  connectionId: "icn_openai",
  secretType: "api_key",
  upstreamBaseUrl: "https://api.openai.com/v1",
  authInjectionType: "bearer",
  authInjectionTarget: "authorization",
  purpose: "api_key",
  resolverKey: "default",
  allowedMethods: ["GET", "POST"],
  allowedPathPrefixes: ["/v1"],
};

async function signGrantPayload(input: {
  payload: Record<string, unknown>;
  issuer?: string;
  audience?: string;
  subject?: string;
  jti?: string;
  expiresInSeconds?: number;
}): Promise<string> {
  const nowEpochSeconds = Math.floor(Date.now() / 1000);

  return new SignJWT(input.payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(input.issuer ?? defaultConfig.tokenIssuer)
    .setAudience(input.audience ?? defaultConfig.tokenAudience)
    .setSubject(input.subject ?? defaultClaims.sub)
    .setJti(input.jti ?? defaultClaims.jti)
    .setIssuedAt(nowEpochSeconds)
    .setExpirationTime(nowEpochSeconds + (input.expiresInSeconds ?? 60))
    .sign(createSecretKey(new TextEncoder().encode(defaultConfig.tokenSecret)));
}

describe("egress-grant", () => {
  it("round-trips a signed egress grant", async () => {
    const token = await mintEgressGrant({
      config: defaultConfig,
      claims: defaultClaims,
      ttlSeconds: 60,
    });

    await expect(
      verifyEgressGrant({
        config: defaultConfig,
        token,
      }),
    ).resolves.toEqual(defaultClaims);
  });

  it("round-trips a signed egress grant without optional claims", async () => {
    const claims: EgressGrantClaims = {
      sub: defaultClaims.sub,
      jti: defaultClaims.jti,
      bindingId: defaultClaims.bindingId,
      connectionId: defaultClaims.connectionId,
      secretType: defaultClaims.secretType,
      upstreamBaseUrl: defaultClaims.upstreamBaseUrl,
      authInjectionType: defaultClaims.authInjectionType,
      authInjectionTarget: defaultClaims.authInjectionTarget,
    };

    const token = await mintEgressGrant({
      config: defaultConfig,
      claims,
      ttlSeconds: 60,
    });

    await expect(
      verifyEgressGrant({
        config: defaultConfig,
        token,
      }),
    ).resolves.toEqual(claims);
  });

  it("allows basic auth grants to carry authInjectionUsername", async () => {
    const token = await mintEgressGrant({
      config: defaultConfig,
      claims: {
        ...defaultClaims,
        authInjectionType: "basic",
        authInjectionUsername: "x-access-token",
      },
      ttlSeconds: 60,
    });

    await expect(
      verifyEgressGrant({
        config: defaultConfig,
        token,
      }),
    ).resolves.toMatchObject({
      authInjectionType: "basic",
      authInjectionUsername: "x-access-token",
    });
  });

  it("rejects authInjectionUsername outside basic auth grants", async () => {
    await expect(
      mintEgressGrant({
        config: defaultConfig,
        claims: {
          ...defaultClaims,
          authInjectionUsername: "x-access-token",
        },
        ttlSeconds: 60,
      }),
    ).rejects.toMatchObject({
      code: EgressGrantErrorCode.AUTH_INJECTION_USERNAME_INVALID,
    });
  });

  it("rejects empty required claim values during minting", async () => {
    await expect(
      mintEgressGrant({
        config: defaultConfig,
        claims: {
          ...defaultClaims,
          bindingId: "   ",
        },
        ttlSeconds: 60,
      }),
    ).rejects.toMatchObject({
      code: EgressGrantErrorCode.BINDING_ID_REQUIRED,
    });
  });

  it("rejects invalid allowedMethods and allowedPathPrefixes during minting", async () => {
    await expect(
      mintEgressGrant({
        config: defaultConfig,
        claims: {
          ...defaultClaims,
          allowedMethods: ["GET", ""],
        },
        ttlSeconds: 60,
      }),
    ).rejects.toMatchObject({
      code: EgressGrantErrorCode.ALLOWED_METHODS_INVALID,
    });

    await expect(
      mintEgressGrant({
        config: defaultConfig,
        claims: {
          ...defaultClaims,
          allowedPathPrefixes: ["/v1", " "],
        },
        ttlSeconds: 60,
      }),
    ).rejects.toMatchObject({
      code: EgressGrantErrorCode.ALLOWED_PATH_PREFIXES_INVALID,
    });
  });

  it("rejects invalid ttlSeconds during minting", async () => {
    await expect(
      mintEgressGrant({
        config: defaultConfig,
        claims: defaultClaims,
        ttlSeconds: 0,
      }),
    ).rejects.toMatchObject({
      code: EgressGrantErrorCode.TOKEN_INVALID_CLAIMS,
    });
  });

  it("rejects blank tokens during verification", async () => {
    await expect(
      verifyEgressGrant({
        config: defaultConfig,
        token: "   ",
      }),
    ).rejects.toMatchObject({
      code: EgressGrantErrorCode.TOKEN_REQUIRED,
    });
  });

  it("rejects issuer mismatches during verification", async () => {
    const token = await mintEgressGrant({
      config: defaultConfig,
      claims: defaultClaims,
      ttlSeconds: 60,
    });

    await expect(
      verifyEgressGrant({
        config: {
          ...defaultConfig,
          tokenIssuer: "control-plane-api",
        },
        token,
      }),
    ).rejects.toMatchObject({
      code: EgressGrantErrorCode.TOKEN_INVALID_ISSUER,
    });
  });

  it("rejects audience mismatches during verification", async () => {
    const token = await mintEgressGrant({
      config: defaultConfig,
      claims: defaultClaims,
      ttlSeconds: 60,
    });

    await expect(
      verifyEgressGrant({
        config: {
          ...defaultConfig,
          tokenAudience: "data-plane-gateway",
        },
        token,
      }),
    ).rejects.toMatchObject({
      code: EgressGrantErrorCode.TOKEN_INVALID_AUDIENCE,
    });
  });

  it("rejects expired tokens during verification", async () => {
    const token = await signGrantPayload({
      payload: {
        bindingId: defaultClaims.bindingId,
        connectionId: defaultClaims.connectionId,
        secretType: defaultClaims.secretType,
        upstreamBaseUrl: defaultClaims.upstreamBaseUrl,
        authInjectionType: defaultClaims.authInjectionType,
        authInjectionTarget: defaultClaims.authInjectionTarget,
      },
      expiresInSeconds: -1,
    });

    await expect(
      verifyEgressGrant({
        config: defaultConfig,
        token,
      }),
    ).rejects.toMatchObject({
      code: EgressGrantErrorCode.TOKEN_EXPIRED,
    });
  });

  it("rejects malformed tokens during verification", async () => {
    await expect(
      verifyEgressGrant({
        config: defaultConfig,
        token: "not-a-jwt",
      }),
    ).rejects.toMatchObject({
      code: EgressGrantErrorCode.TOKEN_VERIFICATION_FAILED,
    });
  });

  it("rejects signed tokens with invalid auth injection types during verification", async () => {
    const token = await signGrantPayload({
      payload: {
        bindingId: defaultClaims.bindingId,
        connectionId: defaultClaims.connectionId,
        secretType: defaultClaims.secretType,
        upstreamBaseUrl: defaultClaims.upstreamBaseUrl,
        authInjectionType: "unsupported",
        authInjectionTarget: defaultClaims.authInjectionTarget,
      },
    });

    await expect(
      verifyEgressGrant({
        config: defaultConfig,
        token,
      }),
    ).rejects.toMatchObject({
      code: EgressGrantErrorCode.AUTH_INJECTION_TYPE_REQUIRED,
    });
  });

  it("rejects signed tokens with blank required claims during verification", async () => {
    const token = await signGrantPayload({
      payload: {
        bindingId: "   ",
        connectionId: defaultClaims.connectionId,
        secretType: defaultClaims.secretType,
        upstreamBaseUrl: defaultClaims.upstreamBaseUrl,
        authInjectionType: defaultClaims.authInjectionType,
        authInjectionTarget: defaultClaims.authInjectionTarget,
      },
    });

    await expect(
      verifyEgressGrant({
        config: defaultConfig,
        token,
      }),
    ).rejects.toMatchObject({
      code: EgressGrantErrorCode.BINDING_ID_REQUIRED,
    });
  });
});
