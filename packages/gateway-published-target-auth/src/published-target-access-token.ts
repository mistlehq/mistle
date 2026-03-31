import { SignJWT, errors as JoseErrors, jwtVerify } from "jose";

import { toNonEmptyString, toSecretKey } from "./shared.js";

const AllowedPublishedTargetAccessTokenAlgorithms = ["HS256"];

export type PublishedTargetAccessTokenConfig = {
  tokenSecret: string;
  tokenIssuer: string;
  tokenAudience: string;
};

export type VerifiedPublishedTargetAccessToken = {
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
  SANDBOX_INSTANCE_ID_REQUIRED: "SANDBOX_INSTANCE_ID_REQUIRED",
} as const;

export type PublishedTargetAccessTokenErrorCode =
  (typeof PublishedTargetAccessTokenErrorCode)[keyof typeof PublishedTargetAccessTokenErrorCode];

type PublishedTargetAccessTokenErrorInput = {
  code: PublishedTargetAccessTokenErrorCode;
  message: string;
  cause?: unknown;
};

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

function normalizeTargetKind(targetKind: string): "port" {
  if (targetKind !== "port") {
    throw new PublishedTargetAccessTokenError({
      code: PublishedTargetAccessTokenErrorCode.TARGET_KIND_INVALID,
      message: "Published target access token targetKind must be 'port'.",
    });
  }

  return "port";
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
  const normalizedJti = toNonEmptyString(input.jti);
  if (normalizedJti === undefined) {
    throw new PublishedTargetAccessTokenError({
      code: PublishedTargetAccessTokenErrorCode.JTI_REQUIRED,
      message: "Published target access token jti claim is required.",
    });
  }

  const normalizedHost = toNonEmptyString(input.host);
  if (normalizedHost === undefined) {
    throw new PublishedTargetAccessTokenError({
      code: PublishedTargetAccessTokenErrorCode.HOST_REQUIRED,
      message: "Published target access token host claim is required.",
    });
  }

  const normalizedSandboxInstanceId = toNonEmptyString(input.sandboxInstanceId);
  if (normalizedSandboxInstanceId === undefined) {
    throw new PublishedTargetAccessTokenError({
      code: PublishedTargetAccessTokenErrorCode.SANDBOX_INSTANCE_ID_REQUIRED,
      message: "Published target access token sandboxInstanceId claim is required.",
    });
  }

  const normalizedTargetId = toNonEmptyString(input.targetId);
  if (normalizedTargetId === undefined) {
    throw new PublishedTargetAccessTokenError({
      code: PublishedTargetAccessTokenErrorCode.TARGET_ID_REQUIRED,
      message: "Published target access token targetId claim is required.",
    });
  }

  const normalizedOrganizationId = toNonEmptyString(input.organizationId);
  if (normalizedOrganizationId === undefined) {
    throw new PublishedTargetAccessTokenError({
      code: PublishedTargetAccessTokenErrorCode.ORGANIZATION_ID_REQUIRED,
      message: "Published target access token organizationId claim is required.",
    });
  }

  const normalizedUserId = toNonEmptyString(input.userId);
  if (normalizedUserId === undefined) {
    throw new PublishedTargetAccessTokenError({
      code: PublishedTargetAccessTokenErrorCode.USER_ID_REQUIRED,
      message: "Published target access token userId claim is required.",
    });
  }

  const normalizedTargetKind = normalizeTargetKind(input.targetKind);
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
      host: normalizedHost,
      organizationId: normalizedOrganizationId,
      sandboxInstanceId: normalizedSandboxInstanceId,
      targetId: normalizedTargetId,
      targetKind: normalizedTargetKind,
      userId: normalizedUserId,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setJti(normalizedJti)
      .setIssuer(input.config.tokenIssuer)
      .setAudience(input.config.tokenAudience)
      .setIssuedAt(nowEpochSeconds)
      .setExpirationTime(nowEpochSeconds + input.ttlSeconds)
      .sign(toSecretKey(input.config.tokenSecret));
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
  const normalizedToken = toNonEmptyString(input.token);
  if (normalizedToken === undefined) {
    throw new PublishedTargetAccessTokenError({
      code: PublishedTargetAccessTokenErrorCode.TOKEN_REQUIRED,
      message: "Published target access token is required.",
    });
  }

  let payloadJti: string | undefined;
  let payloadHost: string | undefined;
  let payloadOrganizationId: string | undefined;
  let payloadSandboxInstanceId: string | undefined;
  let payloadTargetId: string | undefined;
  let payloadTargetKind: string | undefined;
  let payloadUserId: string | undefined;

  try {
    const verificationResult = await jwtVerify(
      normalizedToken,
      toSecretKey(input.config.tokenSecret),
      {
        algorithms: AllowedPublishedTargetAccessTokenAlgorithms,
        issuer: input.config.tokenIssuer,
        audience: input.config.tokenAudience,
      },
    );
    payloadJti = verificationResult.payload.jti;
    if (typeof verificationResult.payload.host === "string") {
      payloadHost = verificationResult.payload.host;
    }
    if (typeof verificationResult.payload.organizationId === "string") {
      payloadOrganizationId = verificationResult.payload.organizationId;
    }
    if (typeof verificationResult.payload.sandboxInstanceId === "string") {
      payloadSandboxInstanceId = verificationResult.payload.sandboxInstanceId;
    }
    if (typeof verificationResult.payload.targetId === "string") {
      payloadTargetId = verificationResult.payload.targetId;
    }
    if (typeof verificationResult.payload.targetKind === "string") {
      payloadTargetKind = verificationResult.payload.targetKind;
    }
    if (typeof verificationResult.payload.userId === "string") {
      payloadUserId = verificationResult.payload.userId;
    }
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

  const normalizedJti = toNonEmptyString(payloadJti);
  if (normalizedJti === undefined) {
    throw new PublishedTargetAccessTokenError({
      code: PublishedTargetAccessTokenErrorCode.JTI_REQUIRED,
      message: "Published target access token jti claim is required.",
    });
  }

  const normalizedHost = toNonEmptyString(payloadHost);
  if (normalizedHost === undefined) {
    throw new PublishedTargetAccessTokenError({
      code: PublishedTargetAccessTokenErrorCode.HOST_REQUIRED,
      message: "Published target access token host claim is required.",
    });
  }

  const normalizedOrganizationId = toNonEmptyString(payloadOrganizationId);
  if (normalizedOrganizationId === undefined) {
    throw new PublishedTargetAccessTokenError({
      code: PublishedTargetAccessTokenErrorCode.ORGANIZATION_ID_REQUIRED,
      message: "Published target access token organizationId claim is required.",
    });
  }

  const normalizedSandboxInstanceId = toNonEmptyString(payloadSandboxInstanceId);
  if (normalizedSandboxInstanceId === undefined) {
    throw new PublishedTargetAccessTokenError({
      code: PublishedTargetAccessTokenErrorCode.SANDBOX_INSTANCE_ID_REQUIRED,
      message: "Published target access token sandboxInstanceId claim is required.",
    });
  }

  const normalizedTargetId = toNonEmptyString(payloadTargetId);
  if (normalizedTargetId === undefined) {
    throw new PublishedTargetAccessTokenError({
      code: PublishedTargetAccessTokenErrorCode.TARGET_ID_REQUIRED,
      message: "Published target access token targetId claim is required.",
    });
  }

  const normalizedUserId = toNonEmptyString(payloadUserId);
  if (normalizedUserId === undefined) {
    throw new PublishedTargetAccessTokenError({
      code: PublishedTargetAccessTokenErrorCode.USER_ID_REQUIRED,
      message: "Published target access token userId claim is required.",
    });
  }

  return {
    host: normalizedHost,
    jti: normalizedJti,
    organizationId: normalizedOrganizationId,
    sandboxInstanceId: normalizedSandboxInstanceId,
    targetId: normalizedTargetId,
    targetKind: normalizeTargetKind(payloadTargetKind ?? ""),
    userId: normalizedUserId,
  };
}
