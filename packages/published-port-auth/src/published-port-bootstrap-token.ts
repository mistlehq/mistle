import { createSecretKey } from "node:crypto";

import { SignJWT, errors as JoseErrors, jwtVerify } from "jose";

const AllowedAlgorithms = ["HS256"];
const JwtSecretEncoder = new TextEncoder();

export type PublishedPortBootstrapTokenConfig = {
  tokenSecret: string;
  tokenIssuer: string;
  tokenAudience: string;
};

export type VerifiedPublishedPortBootstrapToken = {
  jti: string;
  sandboxInstanceId: string;
  port: number;
  host: string;
  expiresAtEpochSeconds: number;
};

export const PublishedPortBootstrapTokenErrorCode = {
  HOST_REQUIRED: "HOST_REQUIRED",
  INVALID_TTL_SECONDS: "INVALID_TTL_SECONDS",
  JTI_REQUIRED: "JTI_REQUIRED",
  PORT_INVALID: "PORT_INVALID",
  SANDBOX_INSTANCE_ID_REQUIRED: "SANDBOX_INSTANCE_ID_REQUIRED",
  TOKEN_EXPIRED: "TOKEN_EXPIRED",
  TOKEN_INVALID_AUDIENCE: "TOKEN_INVALID_AUDIENCE",
  TOKEN_INVALID_CLAIMS: "TOKEN_INVALID_CLAIMS",
  TOKEN_INVALID_ISSUER: "TOKEN_INVALID_ISSUER",
  TOKEN_REQUIRED: "TOKEN_REQUIRED",
  TOKEN_SIGNING_FAILED: "TOKEN_SIGNING_FAILED",
  TOKEN_VERIFICATION_FAILED: "TOKEN_VERIFICATION_FAILED",
} as const;

export type PublishedPortBootstrapTokenErrorCode =
  (typeof PublishedPortBootstrapTokenErrorCode)[keyof typeof PublishedPortBootstrapTokenErrorCode];

export class PublishedPortBootstrapTokenError extends Error {
  readonly code: PublishedPortBootstrapTokenErrorCode;

  public constructor(input: {
    code: PublishedPortBootstrapTokenErrorCode;
    message: string;
    cause?: unknown;
  }) {
    super(input.message, { cause: input.cause });
    this.name = "PublishedPortBootstrapTokenError";
    this.code = input.code;
  }
}

function toSecretKey(secret: string): ReturnType<typeof createSecretKey> {
  return createSecretKey(JwtSecretEncoder.encode(secret));
}

function requireNonEmptyString(input: {
  code: PublishedPortBootstrapTokenErrorCode;
  field: string;
  value: string | undefined;
}): string {
  const normalized = input.value?.trim();
  if (normalized === undefined || normalized.length === 0) {
    throw new PublishedPortBootstrapTokenError({
      code: input.code,
      message: `${input.field} is required.`,
    });
  }

  return normalized;
}

function requirePort(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new PublishedPortBootstrapTokenError({
      code: PublishedPortBootstrapTokenErrorCode.PORT_INVALID,
      message: "Published port must be an integer between 1 and 65535.",
    });
  }

  return value;
}

function mapClaimValidationErrorCode(
  error: JoseErrors.JWTClaimValidationFailed,
): PublishedPortBootstrapTokenErrorCode {
  if (error.claim === "iss") {
    return PublishedPortBootstrapTokenErrorCode.TOKEN_INVALID_ISSUER;
  }
  if (error.claim === "aud") {
    return PublishedPortBootstrapTokenErrorCode.TOKEN_INVALID_AUDIENCE;
  }

  return PublishedPortBootstrapTokenErrorCode.TOKEN_INVALID_CLAIMS;
}

export async function mintPublishedPortBootstrapToken(input: {
  config: PublishedPortBootstrapTokenConfig;
  jti: string;
  sandboxInstanceId: string;
  port: number;
  host: string;
  ttlSeconds: number;
}): Promise<string> {
  const jti = requireNonEmptyString({
    code: PublishedPortBootstrapTokenErrorCode.JTI_REQUIRED,
    field: "Published port bootstrap token jti",
    value: input.jti,
  });
  const sandboxInstanceId = requireNonEmptyString({
    code: PublishedPortBootstrapTokenErrorCode.SANDBOX_INSTANCE_ID_REQUIRED,
    field: "Published port bootstrap token sandboxInstanceId",
    value: input.sandboxInstanceId,
  });
  const host = requireNonEmptyString({
    code: PublishedPortBootstrapTokenErrorCode.HOST_REQUIRED,
    field: "Published port bootstrap token host",
    value: input.host,
  });
  const port = requirePort(input.port);

  if (!Number.isInteger(input.ttlSeconds) || input.ttlSeconds < 1) {
    throw new PublishedPortBootstrapTokenError({
      code: PublishedPortBootstrapTokenErrorCode.INVALID_TTL_SECONDS,
      message:
        "Published port bootstrap token ttlSeconds must be an integer greater than or equal to 1.",
    });
  }

  const nowEpochSeconds = Math.floor(Date.now() / 1000);

  try {
    return await new SignJWT({
      sandboxInstanceId,
      port,
      host,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setJti(jti)
      .setIssuer(input.config.tokenIssuer)
      .setAudience(input.config.tokenAudience)
      .setIssuedAt(nowEpochSeconds)
      .setExpirationTime(nowEpochSeconds + input.ttlSeconds)
      .sign(toSecretKey(input.config.tokenSecret));
  } catch (error) {
    throw new PublishedPortBootstrapTokenError({
      code: PublishedPortBootstrapTokenErrorCode.TOKEN_SIGNING_FAILED,
      message: "Failed to sign published port bootstrap token.",
      cause: error,
    });
  }
}

export async function verifyPublishedPortBootstrapToken(input: {
  config: PublishedPortBootstrapTokenConfig;
  token: string;
}): Promise<VerifiedPublishedPortBootstrapToken> {
  const token = requireNonEmptyString({
    code: PublishedPortBootstrapTokenErrorCode.TOKEN_REQUIRED,
    field: "Published port bootstrap token",
    value: input.token,
  });

  let payloadJti: string | undefined;
  let payloadSandboxInstanceId: string | undefined;
  let payloadPort: number | undefined;
  let payloadHost: string | undefined;
  let payloadExp: number | undefined;

  try {
    const verificationResult = await jwtVerify(token, toSecretKey(input.config.tokenSecret), {
      algorithms: AllowedAlgorithms,
      issuer: input.config.tokenIssuer,
      audience: input.config.tokenAudience,
    });

    payloadJti = verificationResult.payload.jti;
    payloadExp = verificationResult.payload.exp;
    if (typeof verificationResult.payload.sandboxInstanceId === "string") {
      payloadSandboxInstanceId = verificationResult.payload.sandboxInstanceId;
    }
    if (typeof verificationResult.payload.port === "number") {
      payloadPort = verificationResult.payload.port;
    }
    if (typeof verificationResult.payload.host === "string") {
      payloadHost = verificationResult.payload.host;
    }
  } catch (error) {
    if (error instanceof JoseErrors.JWTExpired) {
      throw new PublishedPortBootstrapTokenError({
        code: PublishedPortBootstrapTokenErrorCode.TOKEN_EXPIRED,
        message: "Published port bootstrap token is expired.",
        cause: error,
      });
    }
    if (error instanceof JoseErrors.JWTClaimValidationFailed) {
      throw new PublishedPortBootstrapTokenError({
        code: mapClaimValidationErrorCode(error),
        message: "Published port bootstrap token claim validation failed.",
        cause: error,
      });
    }
    if (error instanceof JoseErrors.JOSEError) {
      throw new PublishedPortBootstrapTokenError({
        code: PublishedPortBootstrapTokenErrorCode.TOKEN_VERIFICATION_FAILED,
        message: "Published port bootstrap token verification failed.",
        cause: error,
      });
    }

    throw new PublishedPortBootstrapTokenError({
      code: PublishedPortBootstrapTokenErrorCode.TOKEN_VERIFICATION_FAILED,
      message: "Published port bootstrap token verification failed with unexpected error.",
      cause: error,
    });
  }

  const jti = requireNonEmptyString({
    code: PublishedPortBootstrapTokenErrorCode.JTI_REQUIRED,
    field: "Published port bootstrap token jti",
    value: payloadJti,
  });
  const sandboxInstanceId = requireNonEmptyString({
    code: PublishedPortBootstrapTokenErrorCode.SANDBOX_INSTANCE_ID_REQUIRED,
    field: "Published port bootstrap token sandboxInstanceId",
    value: payloadSandboxInstanceId,
  });
  const host = requireNonEmptyString({
    code: PublishedPortBootstrapTokenErrorCode.HOST_REQUIRED,
    field: "Published port bootstrap token host",
    value: payloadHost,
  });
  const port = requirePort(payloadPort ?? NaN);

  if (typeof payloadExp !== "number" || !Number.isFinite(payloadExp)) {
    throw new PublishedPortBootstrapTokenError({
      code: PublishedPortBootstrapTokenErrorCode.TOKEN_INVALID_CLAIMS,
      message: "Published port bootstrap token expiration claim is required.",
    });
  }

  return {
    jti,
    sandboxInstanceId,
    port,
    host,
    expiresAtEpochSeconds: payloadExp,
  };
}
