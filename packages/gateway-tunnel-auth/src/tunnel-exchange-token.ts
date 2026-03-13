import { createSecretKey } from "node:crypto";

import { SignJWT, errors as JoseErrors, jwtVerify } from "jose";

const AllowedTunnelExchangeTokenAlgorithms = ["HS256"];
const JwtSecretEncoder = new TextEncoder();

export type TunnelExchangeTokenConfig = {
  tokenSecret: string;
  tokenIssuer: string;
  tokenAudience: string;
};

export type VerifiedTunnelExchangeToken = {
  jti: string;
  sandboxInstanceId: string;
};

export const TunnelExchangeTokenErrorCode = {
  TOKEN_REQUIRED: "TOKEN_REQUIRED",
  JTI_REQUIRED: "JTI_REQUIRED",
  SANDBOX_INSTANCE_ID_REQUIRED: "SANDBOX_INSTANCE_ID_REQUIRED",
  INVALID_TTL_SECONDS: "INVALID_TTL_SECONDS",
  TOKEN_EXPIRED: "TOKEN_EXPIRED",
  TOKEN_INVALID_ISSUER: "TOKEN_INVALID_ISSUER",
  TOKEN_INVALID_AUDIENCE: "TOKEN_INVALID_AUDIENCE",
  TOKEN_INVALID_CLAIMS: "TOKEN_INVALID_CLAIMS",
  TOKEN_VERIFICATION_FAILED: "TOKEN_VERIFICATION_FAILED",
  TOKEN_SIGNING_FAILED: "TOKEN_SIGNING_FAILED",
} as const;

export type TunnelExchangeTokenErrorCode =
  (typeof TunnelExchangeTokenErrorCode)[keyof typeof TunnelExchangeTokenErrorCode];

type TunnelExchangeTokenErrorInput = {
  code: TunnelExchangeTokenErrorCode;
  message: string;
  cause?: unknown;
};

export class TunnelExchangeTokenError extends Error {
  readonly code: TunnelExchangeTokenErrorCode;

  constructor(input: TunnelExchangeTokenErrorInput) {
    super(input.message, { cause: input.cause });
    this.name = "TunnelExchangeTokenError";
    this.code = input.code;
  }
}

function toNonEmptyString(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (normalized === undefined || normalized.length === 0) {
    return undefined;
  }

  return normalized;
}

function toSecretKey(secret: string): ReturnType<typeof createSecretKey> {
  return createSecretKey(JwtSecretEncoder.encode(secret));
}

function mapClaimValidationErrorCode(
  error: JoseErrors.JWTClaimValidationFailed,
): TunnelExchangeTokenErrorCode {
  if (error.claim === "iss") {
    return TunnelExchangeTokenErrorCode.TOKEN_INVALID_ISSUER;
  }

  if (error.claim === "aud") {
    return TunnelExchangeTokenErrorCode.TOKEN_INVALID_AUDIENCE;
  }

  return TunnelExchangeTokenErrorCode.TOKEN_INVALID_CLAIMS;
}

export async function mintTunnelExchangeToken(input: {
  config: TunnelExchangeTokenConfig;
  jti: string;
  sandboxInstanceId: string;
  ttlSeconds: number;
}): Promise<string> {
  const normalizedJti = toNonEmptyString(input.jti);
  if (normalizedJti === undefined) {
    throw new TunnelExchangeTokenError({
      code: TunnelExchangeTokenErrorCode.JTI_REQUIRED,
      message: "Tunnel exchange token jti claim is required.",
    });
  }
  const normalizedSandboxInstanceId = toNonEmptyString(input.sandboxInstanceId);
  if (normalizedSandboxInstanceId === undefined) {
    throw new TunnelExchangeTokenError({
      code: TunnelExchangeTokenErrorCode.SANDBOX_INSTANCE_ID_REQUIRED,
      message: "Tunnel exchange token sandboxInstanceId claim is required.",
    });
  }

  if (!Number.isInteger(input.ttlSeconds) || input.ttlSeconds < 1) {
    throw new TunnelExchangeTokenError({
      code: TunnelExchangeTokenErrorCode.INVALID_TTL_SECONDS,
      message: "Tunnel exchange token ttlSeconds must be an integer greater than or equal to 1.",
    });
  }

  const nowEpochSeconds = Math.floor(Date.now() / 1000);

  try {
    return await new SignJWT({
      sandboxInstanceId: normalizedSandboxInstanceId,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setJti(normalizedJti)
      .setIssuer(input.config.tokenIssuer)
      .setAudience(input.config.tokenAudience)
      .setIssuedAt(nowEpochSeconds)
      .setExpirationTime(nowEpochSeconds + input.ttlSeconds)
      .sign(toSecretKey(input.config.tokenSecret));
  } catch (error) {
    throw new TunnelExchangeTokenError({
      code: TunnelExchangeTokenErrorCode.TOKEN_SIGNING_FAILED,
      message: "Failed to sign tunnel exchange token.",
      cause: error,
    });
  }
}

export async function verifyTunnelExchangeToken(input: {
  config: TunnelExchangeTokenConfig;
  token: string;
}): Promise<VerifiedTunnelExchangeToken> {
  const normalizedToken = toNonEmptyString(input.token);
  if (normalizedToken === undefined) {
    throw new TunnelExchangeTokenError({
      code: TunnelExchangeTokenErrorCode.TOKEN_REQUIRED,
      message: "Tunnel exchange token is required.",
    });
  }

  let payloadJti: string | undefined;
  let payloadSandboxInstanceId: string | undefined;
  try {
    const verificationResult = await jwtVerify(
      normalizedToken,
      toSecretKey(input.config.tokenSecret),
      {
        algorithms: AllowedTunnelExchangeTokenAlgorithms,
        issuer: input.config.tokenIssuer,
        audience: input.config.tokenAudience,
      },
    );
    payloadJti = verificationResult.payload.jti;
    if (typeof verificationResult.payload.sandboxInstanceId === "string") {
      payloadSandboxInstanceId = verificationResult.payload.sandboxInstanceId;
    }
  } catch (error) {
    if (error instanceof JoseErrors.JWTExpired) {
      throw new TunnelExchangeTokenError({
        code: TunnelExchangeTokenErrorCode.TOKEN_EXPIRED,
        message: "Tunnel exchange token is expired.",
        cause: error,
      });
    }

    if (error instanceof JoseErrors.JWTClaimValidationFailed) {
      throw new TunnelExchangeTokenError({
        code: mapClaimValidationErrorCode(error),
        message: "Tunnel exchange token claim validation failed.",
        cause: error,
      });
    }

    if (error instanceof JoseErrors.JOSEError) {
      throw new TunnelExchangeTokenError({
        code: TunnelExchangeTokenErrorCode.TOKEN_VERIFICATION_FAILED,
        message: "Tunnel exchange token verification failed.",
        cause: error,
      });
    }

    throw new TunnelExchangeTokenError({
      code: TunnelExchangeTokenErrorCode.TOKEN_VERIFICATION_FAILED,
      message: "Tunnel exchange token verification failed with unexpected error.",
      cause: error,
    });
  }

  const normalizedJti = toNonEmptyString(payloadJti);
  if (normalizedJti === undefined) {
    throw new TunnelExchangeTokenError({
      code: TunnelExchangeTokenErrorCode.JTI_REQUIRED,
      message: "Tunnel exchange token jti claim is required.",
    });
  }
  const normalizedSandboxInstanceId = toNonEmptyString(payloadSandboxInstanceId);
  if (normalizedSandboxInstanceId === undefined) {
    throw new TunnelExchangeTokenError({
      code: TunnelExchangeTokenErrorCode.SANDBOX_INSTANCE_ID_REQUIRED,
      message: "Tunnel exchange token sandboxInstanceId claim is required.",
    });
  }

  return {
    jti: normalizedJti,
    sandboxInstanceId: normalizedSandboxInstanceId,
  };
}
