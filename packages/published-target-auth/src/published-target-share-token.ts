import { createSecretKey } from "node:crypto";

import { SignJWT, errors as JoseErrors, jwtVerify } from "jose";

const AllowedPublishedTargetShareTokenAlgorithms = ["HS256"];

export type PublishedTargetShareTokenConfig = {
  tokenAudience: string;
  tokenIssuer: string;
  tokenSecret: string;
};

export type VerifiedPublishedTargetShareToken = {
  expiresAtEpochSeconds: number;
  host: string;
  jti: string;
  sandboxInstanceId: string;
  shareId?: string;
  targetId: string;
  targetKind: "port";
};

export const PublishedTargetShareTokenErrorCode = {
  HOST_REQUIRED: "HOST_REQUIRED",
  INVALID_TTL_SECONDS: "INVALID_TTL_SECONDS",
  JTI_REQUIRED: "JTI_REQUIRED",
  SANDBOX_INSTANCE_ID_REQUIRED: "SANDBOX_INSTANCE_ID_REQUIRED",
  SHARE_ID_INVALID: "SHARE_ID_INVALID",
  TARGET_ID_REQUIRED: "TARGET_ID_REQUIRED",
  TARGET_KIND_INVALID: "TARGET_KIND_INVALID",
  TOKEN_EXPIRED: "TOKEN_EXPIRED",
  TOKEN_INVALID_AUDIENCE: "TOKEN_INVALID_AUDIENCE",
  TOKEN_INVALID_CLAIMS: "TOKEN_INVALID_CLAIMS",
  TOKEN_INVALID_ISSUER: "TOKEN_INVALID_ISSUER",
  TOKEN_REQUIRED: "TOKEN_REQUIRED",
  TOKEN_SIGNING_FAILED: "TOKEN_SIGNING_FAILED",
  TOKEN_VERIFICATION_FAILED: "TOKEN_VERIFICATION_FAILED",
} as const;

export type PublishedTargetShareTokenErrorCode =
  (typeof PublishedTargetShareTokenErrorCode)[keyof typeof PublishedTargetShareTokenErrorCode];

type PublishedTargetShareTokenErrorInput = {
  cause?: unknown;
  code: PublishedTargetShareTokenErrorCode;
  message: string;
};

function trimToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === "" ? undefined : trimmed;
}

export class PublishedTargetShareTokenError extends Error {
  readonly code: PublishedTargetShareTokenErrorCode;

  constructor(input: PublishedTargetShareTokenErrorInput) {
    super(input.message, { cause: input.cause });
    this.name = "PublishedTargetShareTokenError";
    this.code = input.code;
  }
}

function mapClaimValidationErrorCode(
  error: JoseErrors.JWTClaimValidationFailed,
): PublishedTargetShareTokenErrorCode {
  if (error.claim === "iss") {
    return PublishedTargetShareTokenErrorCode.TOKEN_INVALID_ISSUER;
  }

  if (error.claim === "aud") {
    return PublishedTargetShareTokenErrorCode.TOKEN_INVALID_AUDIENCE;
  }

  return PublishedTargetShareTokenErrorCode.TOKEN_INVALID_CLAIMS;
}

export async function mintPublishedTargetShareToken(input: {
  config: PublishedTargetShareTokenConfig;
  host: string;
  jti: string;
  sandboxInstanceId: string;
  shareId?: string;
  targetId: string;
  targetKind: "port";
  ttlSeconds: number;
}): Promise<string> {
  const jti = trimToUndefined(input.jti);
  if (jti === undefined) {
    throw new PublishedTargetShareTokenError({
      code: PublishedTargetShareTokenErrorCode.JTI_REQUIRED,
      message: "Published target share token jti claim is required.",
    });
  }

  const host = trimToUndefined(input.host);
  if (host === undefined) {
    throw new PublishedTargetShareTokenError({
      code: PublishedTargetShareTokenErrorCode.HOST_REQUIRED,
      message: "Published target share token host claim is required.",
    });
  }

  const sandboxInstanceId = trimToUndefined(input.sandboxInstanceId);
  if (sandboxInstanceId === undefined) {
    throw new PublishedTargetShareTokenError({
      code: PublishedTargetShareTokenErrorCode.SANDBOX_INSTANCE_ID_REQUIRED,
      message: "Published target share token sandboxInstanceId claim is required.",
    });
  }

  const targetId = trimToUndefined(input.targetId);
  if (targetId === undefined) {
    throw new PublishedTargetShareTokenError({
      code: PublishedTargetShareTokenErrorCode.TARGET_ID_REQUIRED,
      message: "Published target share token targetId claim is required.",
    });
  }

  if (input.targetKind !== "port") {
    throw new PublishedTargetShareTokenError({
      code: PublishedTargetShareTokenErrorCode.TARGET_KIND_INVALID,
      message: "Published target share token targetKind must be 'port'.",
    });
  }

  const shareId = input.shareId === undefined ? undefined : trimToUndefined(input.shareId);
  if (input.shareId !== undefined && shareId === undefined) {
    throw new PublishedTargetShareTokenError({
      code: PublishedTargetShareTokenErrorCode.SHARE_ID_INVALID,
      message: "Published target share token shareId must be non-empty when provided.",
    });
  }

  if (!Number.isInteger(input.ttlSeconds) || input.ttlSeconds < 1) {
    throw new PublishedTargetShareTokenError({
      code: PublishedTargetShareTokenErrorCode.INVALID_TTL_SECONDS,
      message:
        "Published target share token ttlSeconds must be an integer greater than or equal to 1.",
    });
  }

  const nowEpochSeconds = Math.floor(Date.now() / 1000);

  try {
    return await new SignJWT({
      host,
      sandboxInstanceId,
      ...(shareId === undefined ? {} : { shareId }),
      targetId,
      targetKind: "port",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setJti(jti)
      .setIssuer(input.config.tokenIssuer)
      .setAudience(input.config.tokenAudience)
      .setIssuedAt(nowEpochSeconds)
      .setExpirationTime(nowEpochSeconds + input.ttlSeconds)
      .sign(createSecretKey(new TextEncoder().encode(input.config.tokenSecret)));
  } catch (error) {
    throw new PublishedTargetShareTokenError({
      code: PublishedTargetShareTokenErrorCode.TOKEN_SIGNING_FAILED,
      message: "Failed to sign published target share token.",
      cause: error,
    });
  }
}

export async function verifyPublishedTargetShareToken(input: {
  config: PublishedTargetShareTokenConfig;
  token: string;
}): Promise<VerifiedPublishedTargetShareToken> {
  const token = trimToUndefined(input.token);
  if (token === undefined) {
    throw new PublishedTargetShareTokenError({
      code: PublishedTargetShareTokenErrorCode.TOKEN_REQUIRED,
      message: "Published target share token is required.",
    });
  }

  let payload: Awaited<ReturnType<typeof jwtVerify>>["payload"];

  try {
    payload = (
      await jwtVerify(token, createSecretKey(new TextEncoder().encode(input.config.tokenSecret)), {
        algorithms: AllowedPublishedTargetShareTokenAlgorithms,
        audience: input.config.tokenAudience,
        issuer: input.config.tokenIssuer,
      })
    ).payload;
  } catch (error) {
    if (error instanceof JoseErrors.JWTExpired) {
      throw new PublishedTargetShareTokenError({
        code: PublishedTargetShareTokenErrorCode.TOKEN_EXPIRED,
        message: "Published target share token is expired.",
        cause: error,
      });
    }

    if (error instanceof JoseErrors.JWTClaimValidationFailed) {
      throw new PublishedTargetShareTokenError({
        code: mapClaimValidationErrorCode(error),
        message: "Published target share token claim validation failed.",
        cause: error,
      });
    }

    if (error instanceof JoseErrors.JOSEError) {
      throw new PublishedTargetShareTokenError({
        code: PublishedTargetShareTokenErrorCode.TOKEN_VERIFICATION_FAILED,
        message: "Published target share token verification failed.",
        cause: error,
      });
    }

    throw new PublishedTargetShareTokenError({
      code: PublishedTargetShareTokenErrorCode.TOKEN_VERIFICATION_FAILED,
      message: "Published target share token verification failed with unexpected error.",
      cause: error,
    });
  }

  const jti = trimToUndefined(payload.jti);
  if (jti === undefined) {
    throw new PublishedTargetShareTokenError({
      code: PublishedTargetShareTokenErrorCode.JTI_REQUIRED,
      message: "Published target share token jti claim is required.",
    });
  }

  const host = typeof payload.host === "string" ? trimToUndefined(payload.host) : undefined;
  if (host === undefined) {
    throw new PublishedTargetShareTokenError({
      code: PublishedTargetShareTokenErrorCode.HOST_REQUIRED,
      message: "Published target share token host claim is required.",
    });
  }

  const sandboxInstanceId =
    typeof payload.sandboxInstanceId === "string"
      ? trimToUndefined(payload.sandboxInstanceId)
      : undefined;
  if (sandboxInstanceId === undefined) {
    throw new PublishedTargetShareTokenError({
      code: PublishedTargetShareTokenErrorCode.SANDBOX_INSTANCE_ID_REQUIRED,
      message: "Published target share token sandboxInstanceId claim is required.",
    });
  }

  const targetId =
    typeof payload.targetId === "string" ? trimToUndefined(payload.targetId) : undefined;
  if (targetId === undefined) {
    throw new PublishedTargetShareTokenError({
      code: PublishedTargetShareTokenErrorCode.TARGET_ID_REQUIRED,
      message: "Published target share token targetId claim is required.",
    });
  }

  const shareId =
    payload.shareId === undefined
      ? undefined
      : typeof payload.shareId === "string"
        ? trimToUndefined(payload.shareId)
        : undefined;
  if (payload.shareId !== undefined && shareId === undefined) {
    throw new PublishedTargetShareTokenError({
      code: PublishedTargetShareTokenErrorCode.SHARE_ID_INVALID,
      message: "Published target share token shareId claim must be non-empty when provided.",
    });
  }

  if (payload.targetKind !== "port") {
    throw new PublishedTargetShareTokenError({
      code: PublishedTargetShareTokenErrorCode.TARGET_KIND_INVALID,
      message: "Published target share token targetKind must be 'port'.",
    });
  }

  if (typeof payload.exp !== "number" || !Number.isInteger(payload.exp) || payload.exp < 1) {
    throw new PublishedTargetShareTokenError({
      code: PublishedTargetShareTokenErrorCode.TOKEN_INVALID_CLAIMS,
      message: "Published target share token exp claim is required.",
    });
  }

  return {
    expiresAtEpochSeconds: payload.exp,
    host,
    jti,
    sandboxInstanceId,
    ...(shareId === undefined ? {} : { shareId }),
    targetId,
    targetKind: "port",
  };
}
