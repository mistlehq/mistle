import { createSecretKey } from "node:crypto";

import type { Clock } from "@mistle/time";
import { SignJWT, errors as JoseErrors, jwtVerify } from "jose";
import { z } from "zod";

const AllowedPortAccessSessionAlgorithms = ["HS256"];
const JwtSecretEncoder = new TextEncoder();

export const PortAccessSessionCookieName = "mistle_port_access_session";
export const PortAccessSessionTtlSeconds = 60 * 60;

export type PortAccessSessionConfig = {
  cookieSigningSecret: string;
};

export type VerifiedPortAccessSession = {
  sandboxInstanceId: string;
  port: number;
  host: string;
  upstreamProtocol: "http" | "https";
};

export const PortAccessSessionErrorCode = {
  COOKIE_SIGNING_SECRET_REQUIRED: "COOKIE_SIGNING_SECRET_REQUIRED",
  COOKIE_REQUIRED: "COOKIE_REQUIRED",
  SANDBOX_INSTANCE_ID_REQUIRED: "SANDBOX_INSTANCE_ID_REQUIRED",
  HOST_REQUIRED: "HOST_REQUIRED",
  PORT_INVALID: "PORT_INVALID",
  COOKIE_EXPIRED: "COOKIE_EXPIRED",
  COOKIE_INVALID_CLAIMS: "COOKIE_INVALID_CLAIMS",
  COOKIE_VERIFICATION_FAILED: "COOKIE_VERIFICATION_FAILED",
  COOKIE_SIGNING_FAILED: "COOKIE_SIGNING_FAILED",
} as const;

export type PortAccessSessionErrorCode =
  (typeof PortAccessSessionErrorCode)[keyof typeof PortAccessSessionErrorCode];

type PortAccessSessionErrorInput = {
  code: PortAccessSessionErrorCode;
  message: string;
  cause?: unknown;
};

export class PortAccessSessionError extends Error {
  readonly code: PortAccessSessionErrorCode;

  constructor(input: PortAccessSessionErrorInput) {
    super(input.message, { cause: input.cause });
    this.name = "PortAccessSessionError";
    this.code = input.code;
  }
}

const PortAccessSessionClaimsSchema = z.object({
  sandboxInstanceId: z.string().trim().min(1),
  port: z.number().int().min(1).max(65535),
  host: z.string().trim().min(1),
  upstreamProtocol: z.enum(["http", "https"]),
});

function trimToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed.length === 0) {
    return undefined;
  }

  return trimmed;
}

function validateConfig(config: PortAccessSessionConfig): PortAccessSessionConfig {
  const cookieSigningSecret = trimToUndefined(config.cookieSigningSecret);
  if (cookieSigningSecret === undefined) {
    throw new PortAccessSessionError({
      code: PortAccessSessionErrorCode.COOKIE_SIGNING_SECRET_REQUIRED,
      message: "Port Access session cookie signing secret is required.",
    });
  }

  return {
    cookieSigningSecret,
  };
}

function parseClaims(input: {
  sandboxInstanceId: string;
  port: number;
  host: string;
  upstreamProtocol: "http" | "https";
}): z.infer<typeof PortAccessSessionClaimsSchema> {
  try {
    return PortAccessSessionClaimsSchema.parse(input);
  } catch (error) {
    if (!(error instanceof z.ZodError)) {
      throw error;
    }

    const issue = error.issues[0];
    if (issue?.path[0] === "sandboxInstanceId") {
      throw new PortAccessSessionError({
        code: PortAccessSessionErrorCode.SANDBOX_INSTANCE_ID_REQUIRED,
        message: "Port Access session sandboxInstanceId claim is required.",
        cause: error,
      });
    }
    if (issue?.path[0] === "host") {
      throw new PortAccessSessionError({
        code: PortAccessSessionErrorCode.HOST_REQUIRED,
        message: "Port Access session host claim is required.",
        cause: error,
      });
    }

    throw new PortAccessSessionError({
      code: PortAccessSessionErrorCode.PORT_INVALID,
      message: "Port Access session port claim must be an integer between 1 and 65535.",
      cause: error,
    });
  }
}

export async function mintPortAccessSession(input: {
  config: PortAccessSessionConfig;
  clock: Clock;
  sandboxInstanceId: string;
  port: number;
  host: string;
  upstreamProtocol: "http" | "https";
}): Promise<string> {
  const config = validateConfig(input.config);
  const claims = parseClaims({
    sandboxInstanceId: input.sandboxInstanceId,
    port: input.port,
    host: input.host,
    upstreamProtocol: input.upstreamProtocol,
  });
  const nowEpochSeconds = Math.floor(input.clock.nowMs() / 1000);

  try {
    return await new SignJWT(claims)
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(nowEpochSeconds)
      .setExpirationTime(nowEpochSeconds + PortAccessSessionTtlSeconds)
      .sign(createSecretKey(JwtSecretEncoder.encode(config.cookieSigningSecret)));
  } catch (error) {
    throw new PortAccessSessionError({
      code: PortAccessSessionErrorCode.COOKIE_SIGNING_FAILED,
      message: "Failed to sign Port Access session cookie.",
      cause: error,
    });
  }
}

export async function verifyPortAccessSession(input: {
  config: PortAccessSessionConfig;
  clock: Clock;
  cookie: string;
}): Promise<VerifiedPortAccessSession> {
  const config = validateConfig(input.config);
  const cookie = trimToUndefined(input.cookie);
  if (cookie === undefined) {
    throw new PortAccessSessionError({
      code: PortAccessSessionErrorCode.COOKIE_REQUIRED,
      message: "Port Access session cookie is required.",
    });
  }

  try {
    const verified = await jwtVerify(
      cookie,
      createSecretKey(JwtSecretEncoder.encode(config.cookieSigningSecret)),
      {
        algorithms: AllowedPortAccessSessionAlgorithms,
        currentDate: input.clock.nowDate(),
      },
    );
    return PortAccessSessionClaimsSchema.parse(verified.payload);
  } catch (error) {
    if (error instanceof JoseErrors.JWTExpired) {
      throw new PortAccessSessionError({
        code: PortAccessSessionErrorCode.COOKIE_EXPIRED,
        message: "Port Access session cookie is expired.",
        cause: error,
      });
    }

    if (error instanceof z.ZodError) {
      const issue = error.issues[0];
      if (issue?.path[0] === "sandboxInstanceId") {
        throw new PortAccessSessionError({
          code: PortAccessSessionErrorCode.SANDBOX_INSTANCE_ID_REQUIRED,
          message: "Port Access session sandboxInstanceId claim is required.",
          cause: error,
        });
      }
      if (issue?.path[0] === "host") {
        throw new PortAccessSessionError({
          code: PortAccessSessionErrorCode.HOST_REQUIRED,
          message: "Port Access session host claim is required.",
          cause: error,
        });
      }

      throw new PortAccessSessionError({
        code: PortAccessSessionErrorCode.PORT_INVALID,
        message: "Port Access session port claim must be an integer between 1 and 65535.",
        cause: error,
      });
    }

    if (error instanceof JoseErrors.JOSEError) {
      throw new PortAccessSessionError({
        code:
          error instanceof JoseErrors.JWTClaimValidationFailed
            ? PortAccessSessionErrorCode.COOKIE_INVALID_CLAIMS
            : PortAccessSessionErrorCode.COOKIE_VERIFICATION_FAILED,
        message: "Port Access session cookie verification failed.",
        cause: error,
      });
    }

    throw error;
  }
}

export function createPortAccessSessionSetCookieHeader(input: {
  token: string;
  secure: boolean;
}): string {
  return [
    `${PortAccessSessionCookieName}=${input.token}`,
    `Max-Age=${String(PortAccessSessionTtlSeconds)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    ...(input.secure ? ["Secure"] : []),
  ].join("; ");
}
