import { createHmac, timingSafeEqual } from "node:crypto";

export const PublishedPortSessionCookieName = "mistle_published_port_session";
const SessionPayloadVersion = 1;
const SignatureAlgorithm = "sha256";

export type PublishedPortSession = {
  host: string;
  sandboxInstanceId: string;
  port: number;
  protocol: "http" | "https";
  websocketCapable: boolean;
  expiresAtEpochSeconds: number;
};

export const PublishedPortSessionErrorCode = {
  COOKIE_FORMAT_INVALID: "COOKIE_FORMAT_INVALID",
  COOKIE_REQUIRED: "COOKIE_REQUIRED",
  HOST_REQUIRED: "HOST_REQUIRED",
  SESSION_EXPIRED: "SESSION_EXPIRED",
  SESSION_INVALID: "SESSION_INVALID",
  SESSION_SIGNING_FAILED: "SESSION_SIGNING_FAILED",
} as const;

export type PublishedPortSessionErrorCode =
  (typeof PublishedPortSessionErrorCode)[keyof typeof PublishedPortSessionErrorCode];

export class PublishedPortSessionError extends Error {
  readonly code: PublishedPortSessionErrorCode;

  public constructor(input: {
    code: PublishedPortSessionErrorCode;
    message: string;
    cause?: unknown;
  }) {
    super(input.message, { cause: input.cause });
    this.name = "PublishedPortSessionError";
    this.code = input.code;
  }
}

type PublishedPortSessionPayload = {
  v: number;
  host: string;
  sandboxInstanceId: string;
  port: number;
  protocol: "http" | "https";
  websocketCapable: boolean;
  exp: number;
};

function requireNonEmptyString(input: {
  code: PublishedPortSessionErrorCode;
  field: string;
  value: string | undefined;
}): string {
  const normalized = input.value?.trim();
  if (normalized === undefined || normalized.length === 0) {
    throw new PublishedPortSessionError({
      code: input.code,
      message: `${input.field} is required.`,
    });
  }

  return normalized;
}

function signPayload(input: { cookieSigningSecret: string; payload: string }): string {
  try {
    return createHmac(SignatureAlgorithm, input.cookieSigningSecret)
      .update(input.payload)
      .digest("base64url");
  } catch (error) {
    throw new PublishedPortSessionError({
      code: PublishedPortSessionErrorCode.SESSION_SIGNING_FAILED,
      message: "Failed to sign published port session.",
      cause: error,
    });
  }
}

function encodePayload(payload: PublishedPortSessionPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodePayload(encodedPayload: string): PublishedPortSessionPayload {
  try {
    return JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as PublishedPortSessionPayload;
  } catch (error) {
    throw new PublishedPortSessionError({
      code: PublishedPortSessionErrorCode.COOKIE_FORMAT_INVALID,
      message: "Published port session cookie payload is invalid.",
      cause: error,
    });
  }
}

export function mintPublishedPortSessionCookieValue(input: {
  cookieSigningSecret: string;
  expiresAtEpochSeconds: number;
  host: string;
  port: number;
  protocol: "http" | "https";
  sandboxInstanceId: string;
  websocketCapable: boolean;
}): string {
  const host = requireNonEmptyString({
    code: PublishedPortSessionErrorCode.HOST_REQUIRED,
    field: "Published port session host",
    value: input.host,
  });
  const sandboxInstanceId = requireNonEmptyString({
    code: PublishedPortSessionErrorCode.SESSION_INVALID,
    field: "Published port session sandboxInstanceId",
    value: input.sandboxInstanceId,
  });

  const payload = encodePayload({
    v: SessionPayloadVersion,
    host,
    sandboxInstanceId,
    port: input.port,
    protocol: input.protocol,
    websocketCapable: input.websocketCapable,
    exp: input.expiresAtEpochSeconds,
  });
  const signature = signPayload({
    cookieSigningSecret: input.cookieSigningSecret,
    payload,
  });

  return `${payload}.${signature}`;
}

export function verifyPublishedPortSessionCookieValue(input: {
  cookieSigningSecret: string;
  cookieValue: string;
}): PublishedPortSession {
  const cookieValue = requireNonEmptyString({
    code: PublishedPortSessionErrorCode.COOKIE_REQUIRED,
    field: "Published port session cookie",
    value: input.cookieValue,
  });
  const [encodedPayload, encodedSignature] = cookieValue.split(".");
  if (
    encodedPayload === undefined ||
    encodedPayload.length === 0 ||
    encodedSignature === undefined ||
    encodedSignature.length === 0
  ) {
    throw new PublishedPortSessionError({
      code: PublishedPortSessionErrorCode.COOKIE_FORMAT_INVALID,
      message: "Published port session cookie format is invalid.",
    });
  }

  const expectedSignature = signPayload({
    cookieSigningSecret: input.cookieSigningSecret,
    payload: encodedPayload,
  });
  if (
    expectedSignature.length !== encodedSignature.length ||
    !timingSafeEqual(Buffer.from(expectedSignature, "utf8"), Buffer.from(encodedSignature, "utf8"))
  ) {
    throw new PublishedPortSessionError({
      code: PublishedPortSessionErrorCode.SESSION_INVALID,
      message: "Published port session cookie signature is invalid.",
    });
  }

  const payload = decodePayload(encodedPayload);
  if (
    payload.v !== SessionPayloadVersion ||
    payload.host.trim().length === 0 ||
    payload.sandboxInstanceId.trim().length === 0 ||
    !Number.isInteger(payload.port) ||
    payload.port < 1 ||
    payload.port > 65_535 ||
    (payload.protocol !== "http" && payload.protocol !== "https") ||
    typeof payload.websocketCapable !== "boolean" ||
    !Number.isInteger(payload.exp)
  ) {
    throw new PublishedPortSessionError({
      code: PublishedPortSessionErrorCode.SESSION_INVALID,
      message: "Published port session cookie payload is invalid.",
    });
  }

  const nowEpochSeconds = Math.floor(Date.now() / 1000);
  if (payload.exp <= nowEpochSeconds) {
    throw new PublishedPortSessionError({
      code: PublishedPortSessionErrorCode.SESSION_EXPIRED,
      message: "Published port session cookie is expired.",
    });
  }

  return {
    host: payload.host,
    sandboxInstanceId: payload.sandboxInstanceId,
    port: payload.port,
    protocol: payload.protocol,
    websocketCapable: payload.websocketCapable,
    expiresAtEpochSeconds: payload.exp,
  };
}

export function serializePublishedPortSessionSetCookie(input: {
  cookieValue: string;
  expiresAtEpochSeconds: number;
  isSecure: boolean;
}): string {
  const maxAgeSeconds = Math.max(1, input.expiresAtEpochSeconds - Math.floor(Date.now() / 1000));

  return [
    `${PublishedPortSessionCookieName}=${input.cookieValue}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${String(maxAgeSeconds)}`,
    ...(input.isSecure ? ["Secure"] : []),
  ].join("; ");
}
