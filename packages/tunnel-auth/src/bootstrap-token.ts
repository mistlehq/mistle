import { createSecretKey } from "node:crypto";

import { SignJWT, errors as JoseErrors, jwtVerify } from "jose";

const AllowedBootstrapTokenAlgorithms = ["HS256"];
const JwtSecretEncoder = new TextEncoder();

export type BootstrapTokenConfig = {
  bootstrapTokenSecret: string;
  tokenIssuer: string;
  tokenAudience: string;
};

export type VerifiedBootstrapToken = {
  jti: string;
};

export const BootstrapTokenErrorCode = {
  TOKEN_REQUIRED: "TOKEN_REQUIRED",
  JTI_REQUIRED: "JTI_REQUIRED",
  INVALID_TTL_SECONDS: "INVALID_TTL_SECONDS",
  TOKEN_EXPIRED: "TOKEN_EXPIRED",
  TOKEN_INVALID_ISSUER: "TOKEN_INVALID_ISSUER",
  TOKEN_INVALID_AUDIENCE: "TOKEN_INVALID_AUDIENCE",
  TOKEN_INVALID_CLAIMS: "TOKEN_INVALID_CLAIMS",
  TOKEN_VERIFICATION_FAILED: "TOKEN_VERIFICATION_FAILED",
  TOKEN_SIGNING_FAILED: "TOKEN_SIGNING_FAILED",
} as const;

export type BootstrapTokenErrorCode =
  (typeof BootstrapTokenErrorCode)[keyof typeof BootstrapTokenErrorCode];

type BootstrapTokenErrorInput = {
  code: BootstrapTokenErrorCode;
  message: string;
  cause?: unknown;
};

export class BootstrapTokenError extends Error {
  readonly code: BootstrapTokenErrorCode;

  constructor(input: BootstrapTokenErrorInput) {
    super(input.message, { cause: input.cause });
    this.name = "BootstrapTokenError";
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
): BootstrapTokenErrorCode {
  if (error.claim === "iss") {
    return BootstrapTokenErrorCode.TOKEN_INVALID_ISSUER;
  }

  if (error.claim === "aud") {
    return BootstrapTokenErrorCode.TOKEN_INVALID_AUDIENCE;
  }

  return BootstrapTokenErrorCode.TOKEN_INVALID_CLAIMS;
}

export async function mintBootstrapToken(input: {
  config: BootstrapTokenConfig;
  jti: string;
  ttlSeconds: number;
}): Promise<string> {
  const normalizedJti = toNonEmptyString(input.jti);
  if (normalizedJti === undefined) {
    throw new BootstrapTokenError({
      code: BootstrapTokenErrorCode.JTI_REQUIRED,
      message: "Bootstrap token jti claim is required.",
    });
  }

  if (!Number.isInteger(input.ttlSeconds) || input.ttlSeconds < 1) {
    throw new BootstrapTokenError({
      code: BootstrapTokenErrorCode.INVALID_TTL_SECONDS,
      message: "Bootstrap token ttlSeconds must be an integer greater than or equal to 1.",
    });
  }

  const nowEpochSeconds = Math.floor(Date.now() / 1000);

  try {
    return await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setJti(normalizedJti)
      .setIssuer(input.config.tokenIssuer)
      .setAudience(input.config.tokenAudience)
      .setIssuedAt(nowEpochSeconds)
      .setExpirationTime(nowEpochSeconds + input.ttlSeconds)
      .sign(toSecretKey(input.config.bootstrapTokenSecret));
  } catch (error) {
    throw new BootstrapTokenError({
      code: BootstrapTokenErrorCode.TOKEN_SIGNING_FAILED,
      message: "Failed to sign bootstrap token.",
      cause: error,
    });
  }
}

export async function verifyBootstrapToken(input: {
  config: BootstrapTokenConfig;
  token: string;
}): Promise<VerifiedBootstrapToken> {
  const normalizedToken = toNonEmptyString(input.token);
  if (normalizedToken === undefined) {
    throw new BootstrapTokenError({
      code: BootstrapTokenErrorCode.TOKEN_REQUIRED,
      message: "Bootstrap token is required.",
    });
  }

  let payloadJti: string | undefined;
  try {
    const verificationResult = await jwtVerify(
      normalizedToken,
      toSecretKey(input.config.bootstrapTokenSecret),
      {
        algorithms: AllowedBootstrapTokenAlgorithms,
        issuer: input.config.tokenIssuer,
        audience: input.config.tokenAudience,
      },
    );
    payloadJti = verificationResult.payload.jti;
  } catch (error) {
    if (error instanceof JoseErrors.JWTExpired) {
      throw new BootstrapTokenError({
        code: BootstrapTokenErrorCode.TOKEN_EXPIRED,
        message: "Bootstrap token is expired.",
        cause: error,
      });
    }

    if (error instanceof JoseErrors.JWTClaimValidationFailed) {
      throw new BootstrapTokenError({
        code: mapClaimValidationErrorCode(error),
        message: "Bootstrap token claim validation failed.",
        cause: error,
      });
    }

    if (error instanceof JoseErrors.JOSEError) {
      throw new BootstrapTokenError({
        code: BootstrapTokenErrorCode.TOKEN_VERIFICATION_FAILED,
        message: "Bootstrap token verification failed.",
        cause: error,
      });
    }

    throw new BootstrapTokenError({
      code: BootstrapTokenErrorCode.TOKEN_VERIFICATION_FAILED,
      message: "Bootstrap token verification failed with unexpected error.",
      cause: error,
    });
  }

  const normalizedJti = toNonEmptyString(payloadJti);
  if (normalizedJti === undefined) {
    throw new BootstrapTokenError({
      code: BootstrapTokenErrorCode.JTI_REQUIRED,
      message: "Bootstrap token jti claim is required.",
    });
  }

  return {
    jti: normalizedJti,
  };
}
