import { createSecretKey } from "node:crypto";

import { SignJWT, errors as JoseErrors, jwtVerify } from "jose";

import { isStringArray, normalizeClaims } from "./claims.js";
import {
  EgressGrantError,
  EgressGrantErrorCode,
  type EgressGrantErrorCode as EgressGrantErrorCodeType,
} from "./errors.js";
import type { EgressGrantClaims, EgressGrantClaimsInput, EgressGrantConfig } from "./types.js";

const AllowedEgressGrantAlgorithms = ["HS256"];

function toSecretKey(secret: string): ReturnType<typeof createSecretKey> {
  return createSecretKey(new TextEncoder().encode(secret));
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}

function mapClaimValidationErrorCode(
  error: JoseErrors.JWTClaimValidationFailed,
): EgressGrantErrorCodeType {
  if (error.claim === "iss") {
    return EgressGrantErrorCode.TOKEN_INVALID_ISSUER;
  }

  if (error.claim === "aud") {
    return EgressGrantErrorCode.TOKEN_INVALID_AUDIENCE;
  }

  return EgressGrantErrorCode.TOKEN_INVALID_CLAIMS;
}

export async function mintEgressGrant(input: {
  config: EgressGrantConfig;
  claims: EgressGrantClaimsInput;
  ttlSeconds: number;
}): Promise<string> {
  if (!Number.isInteger(input.ttlSeconds) || input.ttlSeconds < 1) {
    throw new EgressGrantError({
      code: EgressGrantErrorCode.TOKEN_INVALID_CLAIMS,
      message: "Egress grant ttlSeconds must be an integer greater than or equal to 1.",
    });
  }

  const claims = normalizeClaims(input.claims);
  const nowEpochSeconds = Math.floor(Date.now() / 1000);

  try {
    return await new SignJWT({
      bindingId: claims.bindingId,
      connectionId: claims.connectionId,
      secretType: claims.secretType,
      upstreamBaseUrl: claims.upstreamBaseUrl,
      authInjectionType: claims.authInjectionType,
      ...("authInjectionTarget" in claims
        ? { authInjectionTarget: claims.authInjectionTarget }
        : {}),
      ...("authInjectionUsername" in claims && claims.authInjectionUsername !== undefined
        ? { authInjectionUsername: claims.authInjectionUsername }
        : {}),
      ...("authInjectionService" in claims
        ? { authInjectionService: claims.authInjectionService }
        : {}),
      ...("authInjectionRegion" in claims
        ? { authInjectionRegion: claims.authInjectionRegion }
        : {}),
      ...(claims.additionalHeaders === undefined
        ? {}
        : { additionalHeaders: claims.additionalHeaders }),
      ...(claims.additionalCredentialHeaders === undefined
        ? {}
        : { additionalCredentialHeaders: claims.additionalCredentialHeaders }),
      ...(claims.slotKey === undefined ? {} : { slotKey: claims.slotKey }),
      ...(claims.resolverKey === undefined ? {} : { resolverKey: claims.resolverKey }),
      ...(claims.allowedMethods === undefined ? {} : { allowedMethods: claims.allowedMethods }),
      ...(claims.allowedPathPrefixes === undefined
        ? {}
        : { allowedPathPrefixes: claims.allowedPathPrefixes }),
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(claims.sub)
      .setJti(claims.jti)
      .setIssuer(input.config.tokenIssuer)
      .setAudience(input.config.tokenAudience)
      .setIssuedAt(nowEpochSeconds)
      .setExpirationTime(nowEpochSeconds + input.ttlSeconds)
      .sign(toSecretKey(input.config.tokenSecret));
  } catch (error) {
    throw new EgressGrantError({
      code: EgressGrantErrorCode.TOKEN_SIGNING_FAILED,
      message: "Failed to sign egress grant.",
      cause: error,
    });
  }
}

export async function verifyEgressGrant(input: {
  config: EgressGrantConfig;
  token: string;
}): Promise<EgressGrantClaims> {
  const normalizedToken = input.token.trim();
  if (normalizedToken.length === 0) {
    throw new EgressGrantError({
      code: EgressGrantErrorCode.TOKEN_REQUIRED,
      message: "Egress grant token is required.",
    });
  }

  let payload: EgressGrantClaimsInput | undefined;
  try {
    const verificationResult = await jwtVerify(
      normalizedToken,
      toSecretKey(input.config.tokenSecret),
      {
        algorithms: AllowedEgressGrantAlgorithms,
        issuer: input.config.tokenIssuer,
        audience: input.config.tokenAudience,
      },
    );

    payload = {
      sub: typeof verificationResult.payload.sub === "string" ? verificationResult.payload.sub : "",
      jti: verificationResult.payload.jti ?? "",
      bindingId:
        typeof verificationResult.payload.bindingId === "string"
          ? verificationResult.payload.bindingId
          : "",
      connectionId:
        typeof verificationResult.payload.connectionId === "string"
          ? verificationResult.payload.connectionId
          : "",
      secretType:
        typeof verificationResult.payload.secretType === "string"
          ? verificationResult.payload.secretType
          : "",
      upstreamBaseUrl:
        typeof verificationResult.payload.upstreamBaseUrl === "string"
          ? verificationResult.payload.upstreamBaseUrl
          : "",
      authInjectionType: verificationResult.payload.authInjectionType,
      ...(typeof verificationResult.payload.authInjectionTarget === "string"
        ? { authInjectionTarget: verificationResult.payload.authInjectionTarget }
        : {}),
      ...(typeof verificationResult.payload.authInjectionUsername === "string"
        ? { authInjectionUsername: verificationResult.payload.authInjectionUsername }
        : {}),
      ...(isStringRecord(verificationResult.payload.additionalHeaders)
        ? { additionalHeaders: verificationResult.payload.additionalHeaders }
        : {}),
      ...(Array.isArray(verificationResult.payload.additionalCredentialHeaders)
        ? {
            additionalCredentialHeaders: verificationResult.payload.additionalCredentialHeaders,
          }
        : {}),
      ...(typeof verificationResult.payload.authInjectionService === "string"
        ? { authInjectionService: verificationResult.payload.authInjectionService }
        : {}),
      ...(typeof verificationResult.payload.authInjectionRegion === "string"
        ? { authInjectionRegion: verificationResult.payload.authInjectionRegion }
        : {}),
      ...(typeof verificationResult.payload.slotKey === "string"
        ? { slotKey: verificationResult.payload.slotKey }
        : {}),
      ...(typeof verificationResult.payload.resolverKey === "string"
        ? { resolverKey: verificationResult.payload.resolverKey }
        : {}),
      ...(isStringArray(verificationResult.payload.allowedMethods)
        ? { allowedMethods: verificationResult.payload.allowedMethods }
        : {}),
      ...(isStringArray(verificationResult.payload.allowedPathPrefixes)
        ? { allowedPathPrefixes: verificationResult.payload.allowedPathPrefixes }
        : {}),
    };
  } catch (error) {
    if (error instanceof JoseErrors.JWTExpired) {
      throw new EgressGrantError({
        code: EgressGrantErrorCode.TOKEN_EXPIRED,
        message: "Egress grant token is expired.",
        cause: error,
      });
    }

    if (error instanceof JoseErrors.JWTClaimValidationFailed) {
      throw new EgressGrantError({
        code: mapClaimValidationErrorCode(error),
        message: "Egress grant claim validation failed.",
        cause: error,
      });
    }

    if (error instanceof JoseErrors.JOSEError) {
      throw new EgressGrantError({
        code: EgressGrantErrorCode.TOKEN_VERIFICATION_FAILED,
        message: "Egress grant verification failed.",
        cause: error,
      });
    }

    throw new EgressGrantError({
      code: EgressGrantErrorCode.TOKEN_VERIFICATION_FAILED,
      message: "Egress grant verification failed with unexpected error.",
      cause: error,
    });
  }

  if (payload === undefined) {
    throw new EgressGrantError({
      code: EgressGrantErrorCode.TOKEN_VERIFICATION_FAILED,
      message: "Egress grant verification failed to produce a payload.",
    });
  }

  return normalizeClaims(payload);
}
