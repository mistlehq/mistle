import { createSecretKey } from "node:crypto";

import { SignJWT, errors as JoseErrors, jwtVerify } from "jose";
import { z } from "zod";

const AllowedPortAccessBootstrapTokenAlgorithms = ["HS256"];
const JwtSecretEncoder = new TextEncoder();

export type PortAccessBootstrapTokenConfig = {
  tokenSecret: string;
  tokenIssuer: string;
  tokenAudience: string;
};

export type VerifiedPortAccessBootstrapToken = {
  sandboxInstanceId: string;
  port: number;
  host: string;
};

export const PortAccessBootstrapTokenErrorCode = {
  TOKEN_REQUIRED: "TOKEN_REQUIRED",
  TOKEN_SECRET_REQUIRED: "TOKEN_SECRET_REQUIRED",
  TOKEN_ISSUER_REQUIRED: "TOKEN_ISSUER_REQUIRED",
  TOKEN_AUDIENCE_REQUIRED: "TOKEN_AUDIENCE_REQUIRED",
  SANDBOX_INSTANCE_ID_REQUIRED: "SANDBOX_INSTANCE_ID_REQUIRED",
  HOST_REQUIRED: "HOST_REQUIRED",
  PORT_INVALID: "PORT_INVALID",
  INVALID_TTL_SECONDS: "INVALID_TTL_SECONDS",
  TOKEN_EXPIRED: "TOKEN_EXPIRED",
  TOKEN_INVALID_ISSUER: "TOKEN_INVALID_ISSUER",
  TOKEN_INVALID_AUDIENCE: "TOKEN_INVALID_AUDIENCE",
  TOKEN_INVALID_CLAIMS: "TOKEN_INVALID_CLAIMS",
  TOKEN_VERIFICATION_FAILED: "TOKEN_VERIFICATION_FAILED",
  TOKEN_SIGNING_FAILED: "TOKEN_SIGNING_FAILED",
} as const;

export type PortAccessBootstrapTokenErrorCode =
  (typeof PortAccessBootstrapTokenErrorCode)[keyof typeof PortAccessBootstrapTokenErrorCode];

type PortAccessBootstrapTokenErrorInput = {
  code: PortAccessBootstrapTokenErrorCode;
  message: string;
  cause?: unknown;
};

export class PortAccessBootstrapTokenError extends Error {
  readonly code: PortAccessBootstrapTokenErrorCode;

  constructor(input: PortAccessBootstrapTokenErrorInput) {
    super(input.message, { cause: input.cause });
    this.name = "PortAccessBootstrapTokenError";
    this.code = input.code;
  }
}

const MintClaimsSchema = z.object({
  sandboxInstanceId: z.string().trim().min(1),
  port: z.number().int().min(1).max(65535),
  host: z.string().trim().min(1),
});

const VerifiedClaimsSchema = z.object({
  sandboxInstanceId: z.string().trim().min(1),
  port: z.number().int().min(1).max(65535),
  host: z.string().trim().min(1),
});

function trimToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed.length === 0) {
    return undefined;
  }

  return trimmed;
}

function validateConfig(config: PortAccessBootstrapTokenConfig): PortAccessBootstrapTokenConfig {
  const tokenSecret = trimToUndefined(config.tokenSecret);
  if (tokenSecret === undefined) {
    throw new PortAccessBootstrapTokenError({
      code: PortAccessBootstrapTokenErrorCode.TOKEN_SECRET_REQUIRED,
      message: "Port Access bootstrap token secret is required.",
    });
  }

  const tokenIssuer = trimToUndefined(config.tokenIssuer);
  if (tokenIssuer === undefined) {
    throw new PortAccessBootstrapTokenError({
      code: PortAccessBootstrapTokenErrorCode.TOKEN_ISSUER_REQUIRED,
      message: "Port Access bootstrap token issuer is required.",
    });
  }

  const tokenAudience = trimToUndefined(config.tokenAudience);
  if (tokenAudience === undefined) {
    throw new PortAccessBootstrapTokenError({
      code: PortAccessBootstrapTokenErrorCode.TOKEN_AUDIENCE_REQUIRED,
      message: "Port Access bootstrap token audience is required.",
    });
  }

  return {
    tokenSecret,
    tokenIssuer,
    tokenAudience,
  };
}

function mapClaimValidationErrorCode(
  error: JoseErrors.JWTClaimValidationFailed,
): PortAccessBootstrapTokenErrorCode {
  if (error.claim === "iss") {
    return PortAccessBootstrapTokenErrorCode.TOKEN_INVALID_ISSUER;
  }

  if (error.claim === "aud") {
    return PortAccessBootstrapTokenErrorCode.TOKEN_INVALID_AUDIENCE;
  }

  return PortAccessBootstrapTokenErrorCode.TOKEN_INVALID_CLAIMS;
}

export async function mintPortAccessBootstrapToken(input: {
  config: PortAccessBootstrapTokenConfig;
  sandboxInstanceId: string;
  port: number;
  host: string;
  ttlSeconds: number;
}): Promise<string> {
  const config = validateConfig(input.config);

  if (!Number.isInteger(input.ttlSeconds) || input.ttlSeconds < 1) {
    throw new PortAccessBootstrapTokenError({
      code: PortAccessBootstrapTokenErrorCode.INVALID_TTL_SECONDS,
      message:
        "Port Access bootstrap token ttlSeconds must be an integer greater than or equal to 1.",
    });
  }

  let claims: z.infer<typeof MintClaimsSchema>;
  try {
    claims = MintClaimsSchema.parse({
      sandboxInstanceId: input.sandboxInstanceId,
      port: input.port,
      host: input.host,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issue = error.issues[0];
      if (issue?.path[0] === "sandboxInstanceId") {
        throw new PortAccessBootstrapTokenError({
          code: PortAccessBootstrapTokenErrorCode.SANDBOX_INSTANCE_ID_REQUIRED,
          message: "Port Access bootstrap token sandboxInstanceId claim is required.",
          cause: error,
        });
      }

      if (issue?.path[0] === "host") {
        throw new PortAccessBootstrapTokenError({
          code: PortAccessBootstrapTokenErrorCode.HOST_REQUIRED,
          message: "Port Access bootstrap token host claim is required.",
          cause: error,
        });
      }

      throw new PortAccessBootstrapTokenError({
        code: PortAccessBootstrapTokenErrorCode.PORT_INVALID,
        message: "Port Access bootstrap token port claim must be an integer between 1 and 65535.",
        cause: error,
      });
    }

    throw error;
  }

  const nowEpochSeconds = Math.floor(Date.now() / 1000);

  try {
    return await new SignJWT(claims)
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(config.tokenIssuer)
      .setAudience(config.tokenAudience)
      .setIssuedAt(nowEpochSeconds)
      .setExpirationTime(nowEpochSeconds + input.ttlSeconds)
      .sign(createSecretKey(JwtSecretEncoder.encode(config.tokenSecret)));
  } catch (error) {
    throw new PortAccessBootstrapTokenError({
      code: PortAccessBootstrapTokenErrorCode.TOKEN_SIGNING_FAILED,
      message: "Failed to sign Port Access bootstrap token.",
      cause: error,
    });
  }
}

export async function verifyPortAccessBootstrapToken(input: {
  config: PortAccessBootstrapTokenConfig;
  token: string;
}): Promise<VerifiedPortAccessBootstrapToken> {
  const config = validateConfig(input.config);
  const token = trimToUndefined(input.token);
  if (token === undefined) {
    throw new PortAccessBootstrapTokenError({
      code: PortAccessBootstrapTokenErrorCode.TOKEN_REQUIRED,
      message: "Port Access bootstrap token is required.",
    });
  }

  let payload: z.infer<typeof VerifiedClaimsSchema>;
  try {
    const verified = await jwtVerify(
      token,
      createSecretKey(JwtSecretEncoder.encode(config.tokenSecret)),
      {
        algorithms: AllowedPortAccessBootstrapTokenAlgorithms,
        issuer: config.tokenIssuer,
        audience: config.tokenAudience,
      },
    );
    payload = VerifiedClaimsSchema.parse(verified.payload);
  } catch (error) {
    if (error instanceof JoseErrors.JWTExpired) {
      throw new PortAccessBootstrapTokenError({
        code: PortAccessBootstrapTokenErrorCode.TOKEN_EXPIRED,
        message: "Port Access bootstrap token is expired.",
        cause: error,
      });
    }

    if (error instanceof JoseErrors.JWTClaimValidationFailed) {
      throw new PortAccessBootstrapTokenError({
        code: mapClaimValidationErrorCode(error),
        message: "Port Access bootstrap token claim validation failed.",
        cause: error,
      });
    }

    if (error instanceof z.ZodError) {
      const issue = error.issues[0];
      if (issue?.path[0] === "sandboxInstanceId") {
        throw new PortAccessBootstrapTokenError({
          code: PortAccessBootstrapTokenErrorCode.SANDBOX_INSTANCE_ID_REQUIRED,
          message: "Port Access bootstrap token sandboxInstanceId claim is required.",
          cause: error,
        });
      }

      if (issue?.path[0] === "host") {
        throw new PortAccessBootstrapTokenError({
          code: PortAccessBootstrapTokenErrorCode.HOST_REQUIRED,
          message: "Port Access bootstrap token host claim is required.",
          cause: error,
        });
      }

      throw new PortAccessBootstrapTokenError({
        code: PortAccessBootstrapTokenErrorCode.PORT_INVALID,
        message: "Port Access bootstrap token port claim must be an integer between 1 and 65535.",
        cause: error,
      });
    }

    if (error instanceof JoseErrors.JOSEError) {
      throw new PortAccessBootstrapTokenError({
        code: PortAccessBootstrapTokenErrorCode.TOKEN_VERIFICATION_FAILED,
        message: "Port Access bootstrap token verification failed.",
        cause: error,
      });
    }

    throw new PortAccessBootstrapTokenError({
      code: PortAccessBootstrapTokenErrorCode.TOKEN_VERIFICATION_FAILED,
      message: "Port Access bootstrap token verification failed with unexpected error.",
      cause: error,
    });
  }

  return payload;
}
