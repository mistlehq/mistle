import { createSecretKey } from "node:crypto";

import { SignJWT, errors as JoseErrors, jwtVerify } from "jose";

const AllowedPtyTransportTokenAlgorithms = ["HS256"];
const JwtSecretEncoder = new TextEncoder();

export const PtyTransportTokenRoles = {
  CLIENT: "client",
  SANDBOX: "sandbox",
} as const;

export type PtyTransportTokenRole =
  (typeof PtyTransportTokenRoles)[keyof typeof PtyTransportTokenRoles];

export type PtyTransportTokenConfig = {
  tokenSecret: string;
  tokenIssuer: string;
  tokenAudience: string;
};

export type PtyTransportTokenClaims = {
  sub: string;
  organizationId: string;
  ptySessionId: string;
  role: PtyTransportTokenRole;
  actingUserId?: string;
};

export type VerifiedPtyTransportToken = PtyTransportTokenClaims & {
  expiresAt: Date;
};

export enum PtyTransportTokenErrorCode {
  TOKEN_REQUIRED = "TOKEN_REQUIRED",
  SANDBOX_INSTANCE_ID_REQUIRED = "SANDBOX_INSTANCE_ID_REQUIRED",
  ORGANIZATION_ID_REQUIRED = "ORGANIZATION_ID_REQUIRED",
  PTY_SESSION_ID_REQUIRED = "PTY_SESSION_ID_REQUIRED",
  ROLE_REQUIRED = "ROLE_REQUIRED",
  ACTING_USER_ID_REQUIRED = "ACTING_USER_ID_REQUIRED",
  ACTING_USER_ID_NOT_ALLOWED = "ACTING_USER_ID_NOT_ALLOWED",
  INVALID_TTL_SECONDS = "INVALID_TTL_SECONDS",
  TOKEN_EXPIRED = "TOKEN_EXPIRED",
  TOKEN_INVALID_ISSUER = "TOKEN_INVALID_ISSUER",
  TOKEN_INVALID_AUDIENCE = "TOKEN_INVALID_AUDIENCE",
  TOKEN_INVALID_CLAIMS = "TOKEN_INVALID_CLAIMS",
  TOKEN_VERIFICATION_FAILED = "TOKEN_VERIFICATION_FAILED",
  TOKEN_SIGNING_FAILED = "TOKEN_SIGNING_FAILED",
}

type PtyTransportTokenErrorInput = {
  code: PtyTransportTokenErrorCode;
  message: string;
  cause?: unknown;
};

export class PtyTransportTokenError extends Error {
  readonly code: PtyTransportTokenErrorCode;

  constructor(input: PtyTransportTokenErrorInput) {
    super(input.message, { cause: input.cause });
    this.name = "PtyTransportTokenError";
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
): PtyTransportTokenErrorCode {
  if (error.claim === "iss") {
    return PtyTransportTokenErrorCode.TOKEN_INVALID_ISSUER;
  }

  if (error.claim === "aud") {
    return PtyTransportTokenErrorCode.TOKEN_INVALID_AUDIENCE;
  }

  return PtyTransportTokenErrorCode.TOKEN_INVALID_CLAIMS;
}

function normalizeRole(value: unknown): PtyTransportTokenRole | undefined {
  if (value === PtyTransportTokenRoles.CLIENT || value === PtyTransportTokenRoles.SANDBOX) {
    return value;
  }

  return undefined;
}

function normalizeClaims(claims: PtyTransportTokenClaims): Omit<
  Required<PtyTransportTokenClaims>,
  "actingUserId"
> & {
  actingUserId?: string;
} {
  const normalizedSandboxInstanceId = toNonEmptyString(claims.sub);
  if (normalizedSandboxInstanceId === undefined) {
    throw new PtyTransportTokenError({
      code: PtyTransportTokenErrorCode.SANDBOX_INSTANCE_ID_REQUIRED,
      message: "PTY transport token subject claim is required.",
    });
  }

  const normalizedOrganizationId = toNonEmptyString(claims.organizationId);
  if (normalizedOrganizationId === undefined) {
    throw new PtyTransportTokenError({
      code: PtyTransportTokenErrorCode.ORGANIZATION_ID_REQUIRED,
      message: "PTY transport token organizationId claim is required.",
    });
  }

  const normalizedPtySessionId = toNonEmptyString(claims.ptySessionId);
  if (normalizedPtySessionId === undefined) {
    throw new PtyTransportTokenError({
      code: PtyTransportTokenErrorCode.PTY_SESSION_ID_REQUIRED,
      message: "PTY transport token ptySessionId claim is required.",
    });
  }

  const normalizedRole = normalizeRole(claims.role);
  if (normalizedRole === undefined) {
    throw new PtyTransportTokenError({
      code: PtyTransportTokenErrorCode.ROLE_REQUIRED,
      message: "PTY transport token role claim is required.",
    });
  }

  const normalizedActingUserId = toNonEmptyString(claims.actingUserId);
  if (normalizedRole === PtyTransportTokenRoles.CLIENT && normalizedActingUserId === undefined) {
    throw new PtyTransportTokenError({
      code: PtyTransportTokenErrorCode.ACTING_USER_ID_REQUIRED,
      message: "PTY transport client token actingUserId claim is required.",
    });
  }

  if (normalizedRole === PtyTransportTokenRoles.SANDBOX && normalizedActingUserId !== undefined) {
    throw new PtyTransportTokenError({
      code: PtyTransportTokenErrorCode.ACTING_USER_ID_NOT_ALLOWED,
      message: "PTY transport sandbox token must not include actingUserId.",
    });
  }

  return {
    sub: normalizedSandboxInstanceId,
    organizationId: normalizedOrganizationId,
    ptySessionId: normalizedPtySessionId,
    role: normalizedRole,
    ...(normalizedActingUserId === undefined ? {} : { actingUserId: normalizedActingUserId }),
  };
}

export async function mintPtyTransportToken(input: {
  claims: PtyTransportTokenClaims;
  config: PtyTransportTokenConfig;
  ttlSeconds: number;
}): Promise<{ token: string; expiresAt: Date }> {
  const normalizedClaims = normalizeClaims(input.claims);

  if (!Number.isInteger(input.ttlSeconds) || input.ttlSeconds < 1) {
    throw new PtyTransportTokenError({
      code: PtyTransportTokenErrorCode.INVALID_TTL_SECONDS,
      message: "PTY transport token ttlSeconds must be an integer greater than or equal to 1.",
    });
  }

  const nowEpochSeconds = Math.floor(Date.now() / 1000);
  const expiresAtEpochSeconds = nowEpochSeconds + input.ttlSeconds;

  try {
    const token = await new SignJWT({
      organizationId: normalizedClaims.organizationId,
      ptySessionId: normalizedClaims.ptySessionId,
      role: normalizedClaims.role,
      ...(normalizedClaims.actingUserId === undefined
        ? {}
        : { actingUserId: normalizedClaims.actingUserId }),
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(normalizedClaims.sub)
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
    if (error instanceof PtyTransportTokenError) {
      throw error;
    }

    throw new PtyTransportTokenError({
      code: PtyTransportTokenErrorCode.TOKEN_SIGNING_FAILED,
      message: "Failed to sign PTY transport token.",
      cause: error,
    });
  }
}

export async function verifyPtyTransportToken(input: {
  config: PtyTransportTokenConfig;
  token: string;
}): Promise<VerifiedPtyTransportToken> {
  const normalizedToken = toNonEmptyString(input.token);
  if (normalizedToken === undefined) {
    throw new PtyTransportTokenError({
      code: PtyTransportTokenErrorCode.TOKEN_REQUIRED,
      message: "PTY transport token is required.",
    });
  }

  try {
    const verificationResult = await jwtVerify(
      normalizedToken,
      toSecretKey(input.config.tokenSecret),
      {
        algorithms: AllowedPtyTransportTokenAlgorithms,
        issuer: input.config.tokenIssuer,
        audience: input.config.tokenAudience,
      },
    );

    const normalizedRole = normalizeRole(verificationResult.payload.role);
    if (normalizedRole === undefined) {
      throw new PtyTransportTokenError({
        code: PtyTransportTokenErrorCode.ROLE_REQUIRED,
        message: "PTY transport token role claim is required.",
      });
    }

    const actingUserId =
      typeof verificationResult.payload.actingUserId === "string"
        ? verificationResult.payload.actingUserId
        : undefined;
    const normalizedClaims = normalizeClaims({
      sub: typeof verificationResult.payload.sub === "string" ? verificationResult.payload.sub : "",
      organizationId:
        typeof verificationResult.payload.organizationId === "string"
          ? verificationResult.payload.organizationId
          : "",
      ptySessionId:
        typeof verificationResult.payload.ptySessionId === "string"
          ? verificationResult.payload.ptySessionId
          : "",
      role: normalizedRole,
      ...(actingUserId === undefined ? {} : { actingUserId }),
    });
    const expiresAtEpochSeconds = verificationResult.payload.exp;

    if (expiresAtEpochSeconds === undefined) {
      throw new PtyTransportTokenError({
        code: PtyTransportTokenErrorCode.TOKEN_INVALID_CLAIMS,
        message: "PTY transport token exp claim is required.",
      });
    }

    return {
      ...normalizedClaims,
      expiresAt: new Date(expiresAtEpochSeconds * 1000),
    };
  } catch (error) {
    if (error instanceof PtyTransportTokenError) {
      throw error;
    }

    if (error instanceof JoseErrors.JWTExpired) {
      throw new PtyTransportTokenError({
        code: PtyTransportTokenErrorCode.TOKEN_EXPIRED,
        message: "PTY transport token is expired.",
        cause: error,
      });
    }

    if (error instanceof JoseErrors.JWTClaimValidationFailed) {
      throw new PtyTransportTokenError({
        code: mapClaimValidationErrorCode(error),
        message: "PTY transport token claim validation failed.",
        cause: error,
      });
    }

    if (error instanceof JoseErrors.JOSEError) {
      throw new PtyTransportTokenError({
        code: PtyTransportTokenErrorCode.TOKEN_VERIFICATION_FAILED,
        message: "PTY transport token verification failed.",
        cause: error,
      });
    }

    throw new PtyTransportTokenError({
      code: PtyTransportTokenErrorCode.TOKEN_VERIFICATION_FAILED,
      message: "PTY transport token verification failed with unexpected error.",
      cause: error,
    });
  }
}
