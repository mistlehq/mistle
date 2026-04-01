import { createSecretKey } from "node:crypto";

import { SignJWT, errors as JoseErrors, jwtVerify } from "jose";

const AllowedPublishedTargetAccessTokenAlgorithms = ["HS256"];

export type PublishedTargetAccessTokenConfig = {
  tokenAudience: string;
  tokenIssuer: string;
  tokenSecret: string;
};

export type VerifiedPublishedTargetAccessToken = {
  expiresAtEpochSeconds: number;
  host: string;
  jti: string;
  organizationId: string;
  sandboxInstanceId: string;
  targetId: string;
  targetKind: "port";
  userId: string;
};

export const PublishedTargetAccessTokenErrorCode = {
  HOST_REQUIRED: "HOST_REQUIRED",
  INVALID_TTL_SECONDS: "INVALID_TTL_SECONDS",
  JTI_REQUIRED: "JTI_REQUIRED",
  ORGANIZATION_ID_REQUIRED: "ORGANIZATION_ID_REQUIRED",
  SANDBOX_INSTANCE_ID_REQUIRED: "SANDBOX_INSTANCE_ID_REQUIRED",
  TARGET_ID_REQUIRED: "TARGET_ID_REQUIRED",
  TARGET_KIND_INVALID: "TARGET_KIND_INVALID",
  TOKEN_EXPIRED: "TOKEN_EXPIRED",
  TOKEN_INVALID_AUDIENCE: "TOKEN_INVALID_AUDIENCE",
  TOKEN_INVALID_CLAIMS: "TOKEN_INVALID_CLAIMS",
  TOKEN_INVALID_ISSUER: "TOKEN_INVALID_ISSUER",
  TOKEN_REQUIRED: "TOKEN_REQUIRED",
  TOKEN_SIGNING_FAILED: "TOKEN_SIGNING_FAILED",
  TOKEN_VERIFICATION_FAILED: "TOKEN_VERIFICATION_FAILED",
  USER_ID_REQUIRED: "USER_ID_REQUIRED",
} as const;

export type PublishedTargetAccessTokenErrorCode =
  (typeof PublishedTargetAccessTokenErrorCode)[keyof typeof PublishedTargetAccessTokenErrorCode];

type PublishedTargetAccessTokenErrorInput = {
  cause?: unknown;
  code: PublishedTargetAccessTokenErrorCode;
  message: string;
};

function trimToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === "" ? undefined : trimmed;
}

export class PublishedTargetAccessTokenError extends Error {
  readonly code: PublishedTargetAccessTokenErrorCode;

  constructor(input: PublishedTargetAccessTokenErrorInput) {
    super(input.message, { cause: input.cause });
    this.name = "PublishedTargetAccessTokenError";
    this.code = input.code;
  }
}

function mapClaimValidationErrorCode(
  error: JoseErrors.JWTClaimValidationFailed,
): PublishedTargetAccessTokenErrorCode {
  if (error.claim === "iss") {
    return PublishedTargetAccessTokenErrorCode.TOKEN_INVALID_ISSUER;
  }

  if (error.claim === "aud") {
    return PublishedTargetAccessTokenErrorCode.TOKEN_INVALID_AUDIENCE;
  }

  return PublishedTargetAccessTokenErrorCode.TOKEN_INVALID_CLAIMS;
}

export async function mintPublishedTargetAccessToken(input: {
  config: PublishedTargetAccessTokenConfig;
  host: string;
  jti: string;
  organizationId: string;
  sandboxInstanceId: string;
  targetId: string;
  targetKind: "port";
  ttlSeconds: number;
  userId: string;
}): Promise<string> {
  const jti = trimToUndefined(input.jti);
  if (jti === undefined) {
    throw new PublishedTargetAccessTokenError({
      code: PublishedTargetAccessTokenErrorCode.JTI_REQUIRED,
      message: "Published target access token jti claim is required.",
    });
  }

  const host = trimToUndefined(input.host);
  if (host === undefined) {
    throw new PublishedTargetAccessTokenError({
      code: PublishedTargetAccessTokenErrorCode.HOST_REQUIRED,
      message: "Published target access token host claim is required.",
    });
  }

  const organizationId = trimToUndefined(input.organizationId);
  if (organizationId === undefined) {
    throw new PublishedTargetAccessTokenError({
      code: PublishedTargetAccessTokenErrorCode.ORGANIZATION_ID_REQUIRED,
      message: "Published target access token organizationId claim is required.",
    });
  }

  const sandboxInstanceId = trimToUndefined(input.sandboxInstanceId);
  if (sandboxInstanceId === undefined) {
    throw new PublishedTargetAccessTokenError({
      code: PublishedTargetAccessTokenErrorCode.SANDBOX_INSTANCE_ID_REQUIRED,
      message: "Published target access token sandboxInstanceId claim is required.",
    });
  }

  const targetId = trimToUndefined(input.targetId);
  if (targetId === undefined) {
    throw new PublishedTargetAccessTokenError({
      code: PublishedTargetAccessTokenErrorCode.TARGET_ID_REQUIRED,
      message: "Published target access token targetId claim is required.",
    });
  }

  const userId = trimToUndefined(input.userId);
  if (userId === undefined) {
    throw new PublishedTargetAccessTokenError({
      code: PublishedTargetAccessTokenErrorCode.USER_ID_REQUIRED,
      message: "Published target access token userId claim is required.",
    });
  }

  if (input.targetKind !== "port") {
    throw new PublishedTargetAccessTokenError({
      code: PublishedTargetAccessTokenErrorCode.TARGET_KIND_INVALID,
      message: "Published target access token targetKind must be 'port'.",
    });
  }

  if (!Number.isInteger(input.ttlSeconds) || input.ttlSeconds < 1) {
    throw new PublishedTargetAccessTokenError({
      code: PublishedTargetAccessTokenErrorCode.INVALID_TTL_SECONDS,
      message:
        "Published target access token ttlSeconds must be an integer greater than or equal to 1.",
    });
  }

  const nowEpochSeconds = Math.floor(Date.now() / 1000);

  try {
    return await new SignJWT({
      host,
      organizationId,
      sandboxInstanceId,
      targetId,
      targetKind: "port",
      userId,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setJti(jti)
      .setIssuer(input.config.tokenIssuer)
      .setAudience(input.config.tokenAudience)
      .setIssuedAt(nowEpochSeconds)
      .setExpirationTime(nowEpochSeconds + input.ttlSeconds)
      .sign(createSecretKey(new TextEncoder().encode(input.config.tokenSecret)));
  } catch (error) {
    throw new PublishedTargetAccessTokenError({
      code: PublishedTargetAccessTokenErrorCode.TOKEN_SIGNING_FAILED,
      message: "Failed to sign published target access token.",
      cause: error,
    });
  }
}

export async function verifyPublishedTargetAccessToken(input: {
  config: PublishedTargetAccessTokenConfig;
  token: string;
}): Promise<VerifiedPublishedTargetAccessToken> {
  const token = trimToUndefined(input.token);
  if (token === undefined) {
    throw new PublishedTargetAccessTokenError({
      code: PublishedTargetAccessTokenErrorCode.TOKEN_REQUIRED,
      message: "Published target access token is required.",
    });
  }

  let payload: Awaited<ReturnType<typeof jwtVerify>>["payload"];

  try {
    payload = (
      await jwtVerify(token, createSecretKey(new TextEncoder().encode(input.config.tokenSecret)), {
        algorithms: AllowedPublishedTargetAccessTokenAlgorithms,
        audience: input.config.tokenAudience,
        issuer: input.config.tokenIssuer,
      })
    ).payload;
  } catch (error) {
    if (error instanceof JoseErrors.JWTExpired) {
      throw new PublishedTargetAccessTokenError({
        code: PublishedTargetAccessTokenErrorCode.TOKEN_EXPIRED,
        message: "Published target access token is expired.",
        cause: error,
      });
    }

    if (error instanceof JoseErrors.JWTClaimValidationFailed) {
      throw new PublishedTargetAccessTokenError({
        code: mapClaimValidationErrorCode(error),
        message: "Published target access token claim validation failed.",
        cause: error,
      });
    }

    if (error instanceof JoseErrors.JOSEError) {
      throw new PublishedTargetAccessTokenError({
        code: PublishedTargetAccessTokenErrorCode.TOKEN_VERIFICATION_FAILED,
        message: "Published target access token verification failed.",
        cause: error,
      });
    }

    throw new PublishedTargetAccessTokenError({
      code: PublishedTargetAccessTokenErrorCode.TOKEN_VERIFICATION_FAILED,
      message: "Published target access token verification failed with unexpected error.",
      cause: error,
    });
  }

  const jti = trimToUndefined(payload.jti);
  if (jti === undefined) {
    throw new PublishedTargetAccessTokenError({
      code: PublishedTargetAccessTokenErrorCode.JTI_REQUIRED,
      message: "Published target access token jti claim is required.",
    });
  }

  const host = typeof payload.host === "string" ? trimToUndefined(payload.host) : undefined;
  if (host === undefined) {
    throw new PublishedTargetAccessTokenError({
      code: PublishedTargetAccessTokenErrorCode.HOST_REQUIRED,
      message: "Published target access token host claim is required.",
    });
  }

  const organizationId =
    typeof payload.organizationId === "string"
      ? trimToUndefined(payload.organizationId)
      : undefined;
  if (organizationId === undefined) {
    throw new PublishedTargetAccessTokenError({
      code: PublishedTargetAccessTokenErrorCode.ORGANIZATION_ID_REQUIRED,
      message: "Published target access token organizationId claim is required.",
    });
  }

  const sandboxInstanceId =
    typeof payload.sandboxInstanceId === "string"
      ? trimToUndefined(payload.sandboxInstanceId)
      : undefined;
  if (sandboxInstanceId === undefined) {
    throw new PublishedTargetAccessTokenError({
      code: PublishedTargetAccessTokenErrorCode.SANDBOX_INSTANCE_ID_REQUIRED,
      message: "Published target access token sandboxInstanceId claim is required.",
    });
  }

  const targetId =
    typeof payload.targetId === "string" ? trimToUndefined(payload.targetId) : undefined;
  if (targetId === undefined) {
    throw new PublishedTargetAccessTokenError({
      code: PublishedTargetAccessTokenErrorCode.TARGET_ID_REQUIRED,
      message: "Published target access token targetId claim is required.",
    });
  }

  const userId = typeof payload.userId === "string" ? trimToUndefined(payload.userId) : undefined;
  if (userId === undefined) {
    throw new PublishedTargetAccessTokenError({
      code: PublishedTargetAccessTokenErrorCode.USER_ID_REQUIRED,
      message: "Published target access token userId claim is required.",
    });
  }

  if (payload.targetKind !== "port") {
    throw new PublishedTargetAccessTokenError({
      code: PublishedTargetAccessTokenErrorCode.TARGET_KIND_INVALID,
      message: "Published target access token targetKind must be 'port'.",
    });
  }

  if (typeof payload.exp !== "number" || !Number.isInteger(payload.exp) || payload.exp < 1) {
    throw new PublishedTargetAccessTokenError({
      code: PublishedTargetAccessTokenErrorCode.TOKEN_INVALID_CLAIMS,
      message: "Published target access token exp claim is required.",
    });
  }

  return {
    expiresAtEpochSeconds: payload.exp,
    host,
    jti,
    organizationId,
    sandboxInstanceId,
    targetId,
    targetKind: "port",
    userId,
  };
}
