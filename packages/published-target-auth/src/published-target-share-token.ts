import { createSecretKey } from "node:crypto";

import { SignJWT, errors as JoseErrors, jwtVerify } from "jose";
import { z } from "zod";

const PublishedTargetShareTokenMintInputSchema = z.object({
  host: z.string().trim().min(1),
  jti: z.string().trim().min(1),
  sandboxInstanceId: z.string().trim().min(1),
  shareId: z.string().trim().min(1).optional(),
  targetId: z.string().trim().min(1),
  targetKind: z.literal("port"),
  ttlSeconds: z.number().int().gte(1),
});
const PublishedTargetShareTokenPayloadSchema = z.object({
  exp: z.number().int().gte(1),
  host: z.string().trim().min(1),
  jti: z.string().trim().min(1),
  sandboxInstanceId: z.string().trim().min(1),
  shareId: z.string().trim().min(1).optional(),
  targetId: z.string().trim().min(1),
  targetKind: z.literal("port"),
});

export type PublishedTargetShareTokenConfig = {
  tokenAudience: string;
  tokenIssuer: string;
  tokenSecret: string;
};

export type VerifiedPublishedTargetShareToken = {
  expiresAtEpochSeconds: number;
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
  SANDBOX_INSTANCE_ID_REQUIRED: "SANDBOX_INSTANCE_ID_REQUIRED",
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
} as const;

export type PublishedTargetShareTokenErrorCode =
  (typeof PublishedTargetShareTokenErrorCode)[keyof typeof PublishedTargetShareTokenErrorCode];

type PublishedTargetShareTokenErrorInput = {
  cause?: unknown;
  code: PublishedTargetShareTokenErrorCode;
  message: string;
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

function mapMintInputErrorCode(
  error: z.ZodError<z.infer<typeof PublishedTargetShareTokenMintInputSchema>>,
): PublishedTargetShareTokenErrorCode {
  switch (error.issues[0]?.path[0]) {
    case "jti":
      return PublishedTargetShareTokenErrorCode.JTI_REQUIRED;
    case "host":
      return PublishedTargetShareTokenErrorCode.HOST_REQUIRED;
    case "sandboxInstanceId":
      return PublishedTargetShareTokenErrorCode.SANDBOX_INSTANCE_ID_REQUIRED;
    case "shareId":
      return PublishedTargetShareTokenErrorCode.SHARE_ID_INVALID;
    case "targetId":
      return PublishedTargetShareTokenErrorCode.TARGET_ID_REQUIRED;
    case "targetKind":
      return PublishedTargetShareTokenErrorCode.TARGET_KIND_INVALID;
    case "ttlSeconds":
      return PublishedTargetShareTokenErrorCode.INVALID_TTL_SECONDS;
    default:
      return PublishedTargetShareTokenErrorCode.TOKEN_INVALID_CLAIMS;
  }
}

function mapPayloadErrorCode(
  error: z.ZodError<z.infer<typeof PublishedTargetShareTokenPayloadSchema>>,
): PublishedTargetShareTokenErrorCode {
  switch (error.issues[0]?.path[0]) {
    case "jti":
      return PublishedTargetShareTokenErrorCode.JTI_REQUIRED;
    case "host":
      return PublishedTargetShareTokenErrorCode.HOST_REQUIRED;
    case "sandboxInstanceId":
      return PublishedTargetShareTokenErrorCode.SANDBOX_INSTANCE_ID_REQUIRED;
    case "shareId":
      return PublishedTargetShareTokenErrorCode.SHARE_ID_INVALID;
    case "targetId":
      return PublishedTargetShareTokenErrorCode.TARGET_ID_REQUIRED;
    case "targetKind":
      return PublishedTargetShareTokenErrorCode.TARGET_KIND_INVALID;
    case "exp":
      return PublishedTargetShareTokenErrorCode.TOKEN_INVALID_CLAIMS;
    default:
      return PublishedTargetShareTokenErrorCode.TOKEN_INVALID_CLAIMS;
  }
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
  const parsedInput = PublishedTargetShareTokenMintInputSchema.safeParse(input);
  if (!parsedInput.success) {
    throw new PublishedTargetShareTokenError({
      code: mapMintInputErrorCode(parsedInput.error),
      message: "Published target share token input is invalid.",
      cause: parsedInput.error,
    });
  }

  const nowEpochSeconds = Math.floor(Date.now() / 1000);
  const { host, jti, sandboxInstanceId, shareId, targetId, ttlSeconds } = parsedInput.data;

  try {
    return await new SignJWT({
      host,
      sandboxInstanceId,
      ...(shareId === undefined ? {} : { shareId }),
      targetId,
      targetKind: "port",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setJti(jti)
      .setIssuer(input.config.tokenIssuer)
      .setAudience(input.config.tokenAudience)
      .setIssuedAt(nowEpochSeconds)
      .setExpirationTime(nowEpochSeconds + ttlSeconds)
      .sign(createSecretKey(new TextEncoder().encode(input.config.tokenSecret)));
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
  const parsedToken = z.string().trim().min(1).safeParse(input.token);
  if (!parsedToken.success) {
    throw new PublishedTargetShareTokenError({
      code: PublishedTargetShareTokenErrorCode.TOKEN_REQUIRED,
      message: "Published target share token is required.",
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

  const parsedPayload = PublishedTargetShareTokenPayloadSchema.safeParse(payload);
  if (!parsedPayload.success) {
    throw new PublishedTargetShareTokenError({
      code: mapPayloadErrorCode(parsedPayload.error),
      message: "Published target share token claims are invalid.",
      cause: parsedPayload.error,
    });
  }

  const verifiedPayload = parsedPayload.data;

  return {
    expiresAtEpochSeconds: verifiedPayload.exp,
    host: verifiedPayload.host,
    jti: verifiedPayload.jti,
    sandboxInstanceId: verifiedPayload.sandboxInstanceId,
    ...(verifiedPayload.shareId ? { shareId: verifiedPayload.shareId } : {}),
    targetId: verifiedPayload.targetId,
    targetKind: "port",
  };
}
