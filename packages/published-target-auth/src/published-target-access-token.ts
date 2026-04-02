import { createSecretKey } from "node:crypto";

import { SignJWT, errors as JoseErrors, jwtVerify } from "jose";
import { z } from "zod";

const PublishedTargetAccessTokenMintInputSchema = z.object({
  host: z.string().trim().min(1),
  jti: z.string().trim().min(1),
  organizationId: z.string().trim().min(1),
  sandboxInstanceId: z.string().trim().min(1),
  targetId: z.string().trim().min(1),
  targetKind: z.literal("port"),
  ttlSeconds: z.number().int().gte(1),
  userId: z.string().trim().min(1),
});
const PublishedTargetAccessTokenPayloadSchema = z.object({
  exp: z.number().int().gte(1),
  host: z.string().trim().min(1),
  jti: z.string().trim().min(1),
  organizationId: z.string().trim().min(1),
  sandboxInstanceId: z.string().trim().min(1),
  targetId: z.string().trim().min(1),
  targetKind: z.literal("port"),
  userId: z.string().trim().min(1),
});

export type PublishedTargetAccessTokenConfig = {
  tokenAudience: string;
  tokenIssuer: string;
  tokenSecret: string;
};

export type VerifiedPublishedTargetAccessToken = {
  expiresAtEpochSeconds: number;
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
  SANDBOX_INSTANCE_ID_REQUIRED: "SANDBOX_INSTANCE_ID_REQUIRED",
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
} as const;

export type PublishedTargetAccessTokenErrorCode =
  (typeof PublishedTargetAccessTokenErrorCode)[keyof typeof PublishedTargetAccessTokenErrorCode];

type PublishedTargetAccessTokenErrorInput = {
  cause?: unknown;
  code: PublishedTargetAccessTokenErrorCode;
  message: string;
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

function mapMintInputErrorCode(
  error: z.ZodError<z.infer<typeof PublishedTargetAccessTokenMintInputSchema>>,
): PublishedTargetAccessTokenErrorCode {
  switch (error.issues[0]?.path[0]) {
    case "jti":
      return PublishedTargetAccessTokenErrorCode.JTI_REQUIRED;
    case "host":
      return PublishedTargetAccessTokenErrorCode.HOST_REQUIRED;
    case "organizationId":
      return PublishedTargetAccessTokenErrorCode.ORGANIZATION_ID_REQUIRED;
    case "sandboxInstanceId":
      return PublishedTargetAccessTokenErrorCode.SANDBOX_INSTANCE_ID_REQUIRED;
    case "targetId":
      return PublishedTargetAccessTokenErrorCode.TARGET_ID_REQUIRED;
    case "targetKind":
      return PublishedTargetAccessTokenErrorCode.TARGET_KIND_INVALID;
    case "ttlSeconds":
      return PublishedTargetAccessTokenErrorCode.INVALID_TTL_SECONDS;
    case "userId":
      return PublishedTargetAccessTokenErrorCode.USER_ID_REQUIRED;
    default:
      return PublishedTargetAccessTokenErrorCode.TOKEN_INVALID_CLAIMS;
  }
}

function mapPayloadErrorCode(
  error: z.ZodError<z.infer<typeof PublishedTargetAccessTokenPayloadSchema>>,
): PublishedTargetAccessTokenErrorCode {
  switch (error.issues[0]?.path[0]) {
    case "jti":
      return PublishedTargetAccessTokenErrorCode.JTI_REQUIRED;
    case "host":
      return PublishedTargetAccessTokenErrorCode.HOST_REQUIRED;
    case "organizationId":
      return PublishedTargetAccessTokenErrorCode.ORGANIZATION_ID_REQUIRED;
    case "sandboxInstanceId":
      return PublishedTargetAccessTokenErrorCode.SANDBOX_INSTANCE_ID_REQUIRED;
    case "targetId":
      return PublishedTargetAccessTokenErrorCode.TARGET_ID_REQUIRED;
    case "targetKind":
      return PublishedTargetAccessTokenErrorCode.TARGET_KIND_INVALID;
    case "userId":
      return PublishedTargetAccessTokenErrorCode.USER_ID_REQUIRED;
    case "exp":
      return PublishedTargetAccessTokenErrorCode.TOKEN_INVALID_CLAIMS;
    default:
      return PublishedTargetAccessTokenErrorCode.TOKEN_INVALID_CLAIMS;
  }
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
  const parsedInput = PublishedTargetAccessTokenMintInputSchema.safeParse(input);
  if (!parsedInput.success) {
    throw new PublishedTargetAccessTokenError({
      code: mapMintInputErrorCode(parsedInput.error),
      message: "Published target access token input is invalid.",
      cause: parsedInput.error,
    });
  }

  const nowEpochSeconds = Math.floor(Date.now() / 1000);
  const { host, jti, organizationId, sandboxInstanceId, targetId, userId, ttlSeconds } =
    parsedInput.data;

  try {
    return await new SignJWT({
      host,
      organizationId,
      sandboxInstanceId,
      targetId,
      targetKind: "port",
      userId,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setJti(jti)
      .setIssuer(input.config.tokenIssuer)
      .setAudience(input.config.tokenAudience)
      .setIssuedAt(nowEpochSeconds)
      .setExpirationTime(nowEpochSeconds + ttlSeconds)
      .sign(createSecretKey(new TextEncoder().encode(input.config.tokenSecret)));
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
  const parsedToken = z.string().trim().min(1).safeParse(input.token);
  if (!parsedToken.success) {
    throw new PublishedTargetAccessTokenError({
      code: PublishedTargetAccessTokenErrorCode.TOKEN_REQUIRED,
      message: "Published target access token is required.",
      cause: parsedToken.error,
    });
  }

  let payload: Awaited<ReturnType<typeof jwtVerify>>["payload"];

  try {
    const verified = await jwtVerify(
      parsedToken.data,
      createSecretKey(new TextEncoder().encode(input.config.tokenSecret)),
      {
        algorithms: ["HS256"],
        audience: input.config.tokenAudience,
        issuer: input.config.tokenIssuer,
      },
    );
    payload = verified.payload;
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

  const parsedPayload = PublishedTargetAccessTokenPayloadSchema.safeParse(payload);
  if (!parsedPayload.success) {
    throw new PublishedTargetAccessTokenError({
      code: mapPayloadErrorCode(parsedPayload.error),
      message: "Published target access token claims are invalid.",
      cause: parsedPayload.error,
    });
  }

  const verifiedPayload = parsedPayload.data;

  return {
    expiresAtEpochSeconds: verifiedPayload.exp,
    host: verifiedPayload.host,
    jti: verifiedPayload.jti,
    organizationId: verifiedPayload.organizationId,
    sandboxInstanceId: verifiedPayload.sandboxInstanceId,
    targetId: verifiedPayload.targetId,
    targetKind: "port",
    userId: verifiedPayload.userId,
  };
}
