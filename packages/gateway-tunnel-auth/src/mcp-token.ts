import { createSecretKey } from "node:crypto";

import { SignJWT, errors as JoseErrors, jwtVerify } from "jose";

const AllowedMcpTokenAlgorithms = ["HS256"];
const JwtSecretEncoder = new TextEncoder();

export type McpTokenConfig = {
  tokenSecret: string;
  tokenIssuer: string;
  tokenAudience: string;
};

export type McpTokenClaims = {
  sub: string;
  organizationId: string;
  apiKeyId: string;
};

export type VerifiedMcpToken = McpTokenClaims & {
  expiresAt: Date;
};

export const McpTokenErrorCode = {
  TOKEN_REQUIRED: "TOKEN_REQUIRED",
  SANDBOX_INSTANCE_ID_REQUIRED: "SANDBOX_INSTANCE_ID_REQUIRED",
  ORGANIZATION_ID_REQUIRED: "ORGANIZATION_ID_REQUIRED",
  API_KEY_ID_REQUIRED: "API_KEY_ID_REQUIRED",
  INVALID_TTL_SECONDS: "INVALID_TTL_SECONDS",
  TOKEN_EXPIRED: "TOKEN_EXPIRED",
  TOKEN_INVALID_ISSUER: "TOKEN_INVALID_ISSUER",
  TOKEN_INVALID_AUDIENCE: "TOKEN_INVALID_AUDIENCE",
  TOKEN_INVALID_CLAIMS: "TOKEN_INVALID_CLAIMS",
  TOKEN_VERIFICATION_FAILED: "TOKEN_VERIFICATION_FAILED",
  TOKEN_SIGNING_FAILED: "TOKEN_SIGNING_FAILED",
} as const;

export type McpTokenErrorCode = (typeof McpTokenErrorCode)[keyof typeof McpTokenErrorCode];

type McpTokenErrorInput = {
  code: McpTokenErrorCode;
  message: string;
  cause?: unknown;
};

export class McpTokenError extends Error {
  readonly code: McpTokenErrorCode;

  constructor(input: McpTokenErrorInput) {
    super(input.message, { cause: input.cause });
    this.name = "McpTokenError";
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
): McpTokenErrorCode {
  if (error.claim === "iss") {
    return McpTokenErrorCode.TOKEN_INVALID_ISSUER;
  }

  if (error.claim === "aud") {
    return McpTokenErrorCode.TOKEN_INVALID_AUDIENCE;
  }

  return McpTokenErrorCode.TOKEN_INVALID_CLAIMS;
}

function normalizeClaims(claims: McpTokenClaims): McpTokenClaims {
  const normalizedSandboxInstanceId = toNonEmptyString(claims.sub);
  if (normalizedSandboxInstanceId === undefined) {
    throw new McpTokenError({
      code: McpTokenErrorCode.SANDBOX_INSTANCE_ID_REQUIRED,
      message: "MCP token subject claim is required.",
    });
  }

  const normalizedOrganizationId = toNonEmptyString(claims.organizationId);
  if (normalizedOrganizationId === undefined) {
    throw new McpTokenError({
      code: McpTokenErrorCode.ORGANIZATION_ID_REQUIRED,
      message: "MCP token organizationId claim is required.",
    });
  }

  const normalizedApiKeyId = toNonEmptyString(claims.apiKeyId);
  if (normalizedApiKeyId === undefined) {
    throw new McpTokenError({
      code: McpTokenErrorCode.API_KEY_ID_REQUIRED,
      message: "MCP token apiKeyId claim is required.",
    });
  }

  return {
    sub: normalizedSandboxInstanceId,
    organizationId: normalizedOrganizationId,
    apiKeyId: normalizedApiKeyId,
  };
}

export async function mintMcpToken(input: {
  claims: McpTokenClaims;
  config: McpTokenConfig;
  ttlSeconds: number;
}): Promise<{ token: string; expiresAt: Date }> {
  const normalizedClaims = normalizeClaims(input.claims);

  if (!Number.isInteger(input.ttlSeconds) || input.ttlSeconds < 1) {
    throw new McpTokenError({
      code: McpTokenErrorCode.INVALID_TTL_SECONDS,
      message: "MCP token ttlSeconds must be an integer greater than or equal to 1.",
    });
  }

  const nowEpochSeconds = Math.floor(Date.now() / 1000);
  const expiresAtEpochSeconds = nowEpochSeconds + input.ttlSeconds;

  try {
    const token = await new SignJWT({
      organizationId: normalizedClaims.organizationId,
      apiKeyId: normalizedClaims.apiKeyId,
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
    if (error instanceof McpTokenError) {
      throw error;
    }

    throw new McpTokenError({
      code: McpTokenErrorCode.TOKEN_SIGNING_FAILED,
      message: "Failed to sign MCP token.",
      cause: error,
    });
  }
}

export async function verifyMcpToken(input: {
  config: McpTokenConfig;
  token: string;
}): Promise<VerifiedMcpToken> {
  const normalizedToken = toNonEmptyString(input.token);
  if (normalizedToken === undefined) {
    throw new McpTokenError({
      code: McpTokenErrorCode.TOKEN_REQUIRED,
      message: "MCP token is required.",
    });
  }

  try {
    const verificationResult = await jwtVerify(
      normalizedToken,
      toSecretKey(input.config.tokenSecret),
      {
        algorithms: AllowedMcpTokenAlgorithms,
        issuer: input.config.tokenIssuer,
        audience: input.config.tokenAudience,
      },
    );

    const normalizedClaims = normalizeClaims({
      sub: typeof verificationResult.payload.sub === "string" ? verificationResult.payload.sub : "",
      organizationId:
        typeof verificationResult.payload.organizationId === "string"
          ? verificationResult.payload.organizationId
          : "",
      apiKeyId:
        typeof verificationResult.payload.apiKeyId === "string"
          ? verificationResult.payload.apiKeyId
          : "",
    });
    const expiresAtEpochSeconds = verificationResult.payload.exp;

    if (expiresAtEpochSeconds === undefined) {
      throw new McpTokenError({
        code: McpTokenErrorCode.TOKEN_INVALID_CLAIMS,
        message: "MCP token exp claim is required.",
      });
    }

    return {
      ...normalizedClaims,
      expiresAt: new Date(expiresAtEpochSeconds * 1000),
    };
  } catch (error) {
    if (error instanceof McpTokenError) {
      throw error;
    }

    if (error instanceof JoseErrors.JWTExpired) {
      throw new McpTokenError({
        code: McpTokenErrorCode.TOKEN_EXPIRED,
        message: "MCP token is expired.",
        cause: error,
      });
    }

    if (error instanceof JoseErrors.JWTClaimValidationFailed) {
      throw new McpTokenError({
        code: mapClaimValidationErrorCode(error),
        message: "MCP token claim validation failed.",
        cause: error,
      });
    }

    if (error instanceof JoseErrors.JOSEError) {
      throw new McpTokenError({
        code: McpTokenErrorCode.TOKEN_VERIFICATION_FAILED,
        message: "MCP token verification failed.",
        cause: error,
      });
    }

    throw new McpTokenError({
      code: McpTokenErrorCode.TOKEN_VERIFICATION_FAILED,
      message: "MCP token verification failed with unexpected error.",
      cause: error,
    });
  }
}
