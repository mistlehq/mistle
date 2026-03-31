import { SignJWT, errors as JoseErrors, jwtVerify } from "jose";

import { toNonEmptyString, toSecretKey } from "./shared.js";

const AllowedPublishedTargetShareTokenAlgorithms = ["HS256"];

export type PublishedTargetShareTokenConfig = {
  tokenAudience: string;
  tokenIssuer: string;
  tokenSecret: string;
};

export type VerifiedPublishedTargetShareToken = {
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
  SANDBOX_INSTANCE_ID_REQUIRED: "SANDBOX_INSTANCE_ID_REQUIRED",
} as const;

export type PublishedTargetShareTokenErrorCode =
  (typeof PublishedTargetShareTokenErrorCode)[keyof typeof PublishedTargetShareTokenErrorCode];

type PublishedTargetShareTokenErrorInput = {
  code: PublishedTargetShareTokenErrorCode;
  message: string;
  cause?: unknown;
};

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

function normalizeTargetKind(targetKind: string): "port" {
  if (targetKind !== "port") {
    throw new PublishedTargetShareTokenError({
      code: PublishedTargetShareTokenErrorCode.TARGET_KIND_INVALID,
      message: "Published target share token targetKind must be 'port'.",
    });
  }

  return "port";
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
  const normalizedJti = toNonEmptyString(input.jti);
  if (normalizedJti === undefined) {
    throw new PublishedTargetShareTokenError({
      code: PublishedTargetShareTokenErrorCode.JTI_REQUIRED,
      message: "Published target share token jti claim is required.",
    });
  }

  const normalizedHost = toNonEmptyString(input.host);
  if (normalizedHost === undefined) {
    throw new PublishedTargetShareTokenError({
      code: PublishedTargetShareTokenErrorCode.HOST_REQUIRED,
      message: "Published target share token host claim is required.",
    });
  }

  const normalizedSandboxInstanceId = toNonEmptyString(input.sandboxInstanceId);
  if (normalizedSandboxInstanceId === undefined) {
    throw new PublishedTargetShareTokenError({
      code: PublishedTargetShareTokenErrorCode.SANDBOX_INSTANCE_ID_REQUIRED,
      message: "Published target share token sandboxInstanceId claim is required.",
    });
  }

  const normalizedTargetId = toNonEmptyString(input.targetId);
  if (normalizedTargetId === undefined) {
    throw new PublishedTargetShareTokenError({
      code: PublishedTargetShareTokenErrorCode.TARGET_ID_REQUIRED,
      message: "Published target share token targetId claim is required.",
    });
  }

  const normalizedTargetKind = normalizeTargetKind(input.targetKind);
  const normalizedShareId =
    input.shareId === undefined ? undefined : toNonEmptyString(input.shareId);
  if (input.shareId !== undefined && normalizedShareId === undefined) {
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
      host: normalizedHost,
      sandboxInstanceId: normalizedSandboxInstanceId,
      ...(normalizedShareId === undefined ? {} : { shareId: normalizedShareId }),
      targetId: normalizedTargetId,
      targetKind: normalizedTargetKind,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setJti(normalizedJti)
      .setIssuer(input.config.tokenIssuer)
      .setAudience(input.config.tokenAudience)
      .setIssuedAt(nowEpochSeconds)
      .setExpirationTime(nowEpochSeconds + input.ttlSeconds)
      .sign(toSecretKey(input.config.tokenSecret));
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
  const normalizedToken = toNonEmptyString(input.token);
  if (normalizedToken === undefined) {
    throw new PublishedTargetShareTokenError({
      code: PublishedTargetShareTokenErrorCode.TOKEN_REQUIRED,
      message: "Published target share token is required.",
    });
  }

  let payloadJti: string | undefined;
  let payloadHost: string | undefined;
  let payloadSandboxInstanceId: string | undefined;
  let payloadShareId: string | undefined;
  let payloadTargetId: string | undefined;
  let payloadTargetKind: string | undefined;

  try {
    const verificationResult = await jwtVerify(
      normalizedToken,
      toSecretKey(input.config.tokenSecret),
      {
        algorithms: AllowedPublishedTargetShareTokenAlgorithms,
        issuer: input.config.tokenIssuer,
        audience: input.config.tokenAudience,
      },
    );
    payloadJti = verificationResult.payload.jti;
    if (typeof verificationResult.payload.host === "string") {
      payloadHost = verificationResult.payload.host;
    }
    if (typeof verificationResult.payload.sandboxInstanceId === "string") {
      payloadSandboxInstanceId = verificationResult.payload.sandboxInstanceId;
    }
    if (typeof verificationResult.payload.shareId === "string") {
      payloadShareId = verificationResult.payload.shareId;
    }
    if (typeof verificationResult.payload.targetId === "string") {
      payloadTargetId = verificationResult.payload.targetId;
    }
    if (typeof verificationResult.payload.targetKind === "string") {
      payloadTargetKind = verificationResult.payload.targetKind;
    }
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

  const normalizedJti = toNonEmptyString(payloadJti);
  if (normalizedJti === undefined) {
    throw new PublishedTargetShareTokenError({
      code: PublishedTargetShareTokenErrorCode.JTI_REQUIRED,
      message: "Published target share token jti claim is required.",
    });
  }

  const normalizedHost = toNonEmptyString(payloadHost);
  if (normalizedHost === undefined) {
    throw new PublishedTargetShareTokenError({
      code: PublishedTargetShareTokenErrorCode.HOST_REQUIRED,
      message: "Published target share token host claim is required.",
    });
  }

  const normalizedSandboxInstanceId = toNonEmptyString(payloadSandboxInstanceId);
  if (normalizedSandboxInstanceId === undefined) {
    throw new PublishedTargetShareTokenError({
      code: PublishedTargetShareTokenErrorCode.SANDBOX_INSTANCE_ID_REQUIRED,
      message: "Published target share token sandboxInstanceId claim is required.",
    });
  }

  const normalizedTargetId = toNonEmptyString(payloadTargetId);
  if (normalizedTargetId === undefined) {
    throw new PublishedTargetShareTokenError({
      code: PublishedTargetShareTokenErrorCode.TARGET_ID_REQUIRED,
      message: "Published target share token targetId claim is required.",
    });
  }

  const normalizedShareId =
    payloadShareId === undefined ? undefined : toNonEmptyString(payloadShareId);
  if (payloadShareId !== undefined && normalizedShareId === undefined) {
    throw new PublishedTargetShareTokenError({
      code: PublishedTargetShareTokenErrorCode.SHARE_ID_INVALID,
      message: "Published target share token shareId claim must be non-empty when provided.",
    });
  }

  return {
    host: normalizedHost,
    jti: normalizedJti,
    sandboxInstanceId: normalizedSandboxInstanceId,
    ...(normalizedShareId === undefined ? {} : { shareId: normalizedShareId }),
    targetId: normalizedTargetId,
    targetKind: normalizeTargetKind(payloadTargetKind ?? ""),
  };
}
