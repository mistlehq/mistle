import { createSecretKey } from "node:crypto";

import { SignJWT, errors as JoseErrors, jwtVerify } from "jose";

const AllowedEgressTokenAlgorithms = ["HS256"];
const JwtSecretEncoder = new TextEncoder();

export type EgressTokenConfig = {
  tokenSecret: string;
  tokenIssuer: string;
  tokenAudience: string;
};

export type EgressTokenClaims = {
  sub: string;
  organizationId: string;
  bootstrapSessionId: string;
};

export type VerifiedEgressToken = EgressTokenClaims & {
  expiresAt: Date;
};

export const EgressTokenErrorCode = {
  TOKEN_REQUIRED: "TOKEN_REQUIRED",
  SANDBOX_INSTANCE_ID_REQUIRED: "SANDBOX_INSTANCE_ID_REQUIRED",
  ORGANIZATION_ID_REQUIRED: "ORGANIZATION_ID_REQUIRED",
  BOOTSTRAP_SESSION_ID_REQUIRED: "BOOTSTRAP_SESSION_ID_REQUIRED",
  INVALID_TTL_SECONDS: "INVALID_TTL_SECONDS",
  TOKEN_EXPIRED: "TOKEN_EXPIRED",
  TOKEN_INVALID_ISSUER: "TOKEN_INVALID_ISSUER",
  TOKEN_INVALID_AUDIENCE: "TOKEN_INVALID_AUDIENCE",
  TOKEN_INVALID_CLAIMS: "TOKEN_INVALID_CLAIMS",
  TOKEN_VERIFICATION_FAILED: "TOKEN_VERIFICATION_FAILED",
  TOKEN_SIGNING_FAILED: "TOKEN_SIGNING_FAILED",
} as const;

export type EgressTokenErrorCode = (typeof EgressTokenErrorCode)[keyof typeof EgressTokenErrorCode];

type EgressTokenErrorInput = {
  code: EgressTokenErrorCode;
  message: string;
  cause?: unknown;
};

export class EgressTokenError extends Error {
  readonly code: EgressTokenErrorCode;

  constructor(input: EgressTokenErrorInput) {
    super(input.message, { cause: input.cause });
    this.name = "EgressTokenError";
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
): EgressTokenErrorCode {
  if (error.claim === "iss") {
    return EgressTokenErrorCode.TOKEN_INVALID_ISSUER;
  }

  if (error.claim === "aud") {
    return EgressTokenErrorCode.TOKEN_INVALID_AUDIENCE;
  }

  return EgressTokenErrorCode.TOKEN_INVALID_CLAIMS;
}

export async function mintEgressToken(input: {
  claims: EgressTokenClaims;
  config: EgressTokenConfig;
  ttlSeconds: number;
}): Promise<{ token: string; expiresAt: Date }> {
  const normalizedSandboxInstanceId = toNonEmptyString(input.claims.sub);
  if (normalizedSandboxInstanceId === undefined) {
    throw new EgressTokenError({
      code: EgressTokenErrorCode.SANDBOX_INSTANCE_ID_REQUIRED,
      message: "Egress token subject claim is required.",
    });
  }

  const normalizedOrganizationId = toNonEmptyString(input.claims.organizationId);
  if (normalizedOrganizationId === undefined) {
    throw new EgressTokenError({
      code: EgressTokenErrorCode.ORGANIZATION_ID_REQUIRED,
      message: "Egress token organizationId claim is required.",
    });
  }

  const normalizedBootstrapSessionId = toNonEmptyString(input.claims.bootstrapSessionId);
  if (normalizedBootstrapSessionId === undefined) {
    throw new EgressTokenError({
      code: EgressTokenErrorCode.BOOTSTRAP_SESSION_ID_REQUIRED,
      message: "Egress token bootstrapSessionId claim is required.",
    });
  }

  if (!Number.isInteger(input.ttlSeconds) || input.ttlSeconds < 1) {
    throw new EgressTokenError({
      code: EgressTokenErrorCode.INVALID_TTL_SECONDS,
      message: "Egress token ttlSeconds must be an integer greater than or equal to 1.",
    });
  }

  const nowEpochSeconds = Math.floor(Date.now() / 1000);
  const expiresAtEpochSeconds = nowEpochSeconds + input.ttlSeconds;

  try {
    const token = await new SignJWT({
      organizationId: normalizedOrganizationId,
      bootstrapSessionId: normalizedBootstrapSessionId,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(normalizedSandboxInstanceId)
      .setIssuer(input.config.tokenIssuer)
      .setAudience(input.config.tokenAudience)
      .setIssuedAt(nowEpochSeconds)
      .setNotBefore(nowEpochSeconds)
      .setExpirationTime(expiresAtEpochSeconds)
      .sign(toSecretKey(input.config.tokenSecret));

    return {
      token,
      expiresAt: new Date(expiresAtEpochSeconds * 1000),
    };
  } catch (error) {
    throw new EgressTokenError({
      code: EgressTokenErrorCode.TOKEN_SIGNING_FAILED,
      message: "Failed to sign egress token.",
      cause: error,
    });
  }
}

export async function verifyEgressToken(input: {
  config: EgressTokenConfig;
  token: string;
}): Promise<VerifiedEgressToken> {
  const normalizedToken = toNonEmptyString(input.token);
  if (normalizedToken === undefined) {
    throw new EgressTokenError({
      code: EgressTokenErrorCode.TOKEN_REQUIRED,
      message: "Egress token is required.",
    });
  }

  try {
    const verificationResult = await jwtVerify(
      normalizedToken,
      toSecretKey(input.config.tokenSecret),
      {
        algorithms: AllowedEgressTokenAlgorithms,
        issuer: input.config.tokenIssuer,
        audience: input.config.tokenAudience,
      },
    );
    const normalizedSandboxInstanceId =
      typeof verificationResult.payload.sub === "string"
        ? toNonEmptyString(verificationResult.payload.sub)
        : undefined;
    const normalizedOrganizationId =
      typeof verificationResult.payload.organizationId === "string"
        ? toNonEmptyString(verificationResult.payload.organizationId)
        : undefined;
    const normalizedBootstrapSessionId =
      typeof verificationResult.payload.bootstrapSessionId === "string"
        ? toNonEmptyString(verificationResult.payload.bootstrapSessionId)
        : undefined;
    const expiresAtEpochSeconds = verificationResult.payload.exp;

    if (normalizedSandboxInstanceId === undefined) {
      throw new EgressTokenError({
        code: EgressTokenErrorCode.SANDBOX_INSTANCE_ID_REQUIRED,
        message: "Egress token subject claim is required.",
      });
    }
    if (normalizedOrganizationId === undefined) {
      throw new EgressTokenError({
        code: EgressTokenErrorCode.ORGANIZATION_ID_REQUIRED,
        message: "Egress token organizationId claim is required.",
      });
    }
    if (normalizedBootstrapSessionId === undefined) {
      throw new EgressTokenError({
        code: EgressTokenErrorCode.BOOTSTRAP_SESSION_ID_REQUIRED,
        message: "Egress token bootstrapSessionId claim is required.",
      });
    }
    if (expiresAtEpochSeconds === undefined) {
      throw new EgressTokenError({
        code: EgressTokenErrorCode.TOKEN_INVALID_CLAIMS,
        message: "Egress token exp claim is required.",
      });
    }

    return {
      sub: normalizedSandboxInstanceId,
      organizationId: normalizedOrganizationId,
      bootstrapSessionId: normalizedBootstrapSessionId,
      expiresAt: new Date(expiresAtEpochSeconds * 1000),
    };
  } catch (error) {
    if (error instanceof EgressTokenError) {
      throw error;
    }

    if (error instanceof JoseErrors.JWTExpired) {
      throw new EgressTokenError({
        code: EgressTokenErrorCode.TOKEN_EXPIRED,
        message: "Egress token is expired.",
        cause: error,
      });
    }

    if (error instanceof JoseErrors.JWTClaimValidationFailed) {
      throw new EgressTokenError({
        code: mapClaimValidationErrorCode(error),
        message: "Egress token claim validation failed.",
        cause: error,
      });
    }

    if (error instanceof JoseErrors.JOSEError) {
      throw new EgressTokenError({
        code: EgressTokenErrorCode.TOKEN_VERIFICATION_FAILED,
        message: "Egress token verification failed.",
        cause: error,
      });
    }

    throw new EgressTokenError({
      code: EgressTokenErrorCode.TOKEN_VERIFICATION_FAILED,
      message: "Egress token verification failed with unexpected error.",
      cause: error,
    });
  }
}
