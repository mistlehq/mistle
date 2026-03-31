import { createHmac, timingSafeEqual } from "node:crypto";

import { toNonEmptyString } from "./shared.js";

type PublishedTargetSessionPayload =
  | {
      exp: number;
      host: string;
      organizationId: string;
      sandboxInstanceId: string;
      sessionKind: "owned";
      targetId: string;
      targetKind: "port";
      userId: string;
    }
  | {
      exp: number;
      host: string;
      sandboxInstanceId: string;
      sessionKind: "shared";
      targetId: string;
      targetKind: "port";
    };

export type PublishedTargetSessionCookieConfig = {
  cookieSigningSecret: string;
};

export type VerifiedPublishedTargetSession =
  | {
      host: string;
      organizationId: string;
      sandboxInstanceId: string;
      sessionKind: "owned";
      targetId: string;
      targetKind: "port";
      userId: string;
    }
  | {
      host: string;
      sandboxInstanceId: string;
      sessionKind: "shared";
      targetId: string;
      targetKind: "port";
    };

export const PublishedTargetSessionCookieErrorCode = {
  COOKIE_EXPIRED: "COOKIE_EXPIRED",
  COOKIE_INVALID_FORMAT: "COOKIE_INVALID_FORMAT",
  COOKIE_INVALID_PAYLOAD: "COOKIE_INVALID_PAYLOAD",
  COOKIE_INVALID_SIGNATURE: "COOKIE_INVALID_SIGNATURE",
  COOKIE_REQUIRED: "COOKIE_REQUIRED",
  HOST_REQUIRED: "HOST_REQUIRED",
  INVALID_TTL_SECONDS: "INVALID_TTL_SECONDS",
  ORGANIZATION_ID_REQUIRED: "ORGANIZATION_ID_REQUIRED",
  SANDBOX_INSTANCE_ID_REQUIRED: "SANDBOX_INSTANCE_ID_REQUIRED",
  SESSION_KIND_INVALID: "SESSION_KIND_INVALID",
  TARGET_ID_REQUIRED: "TARGET_ID_REQUIRED",
  TARGET_KIND_INVALID: "TARGET_KIND_INVALID",
  USER_ID_REQUIRED: "USER_ID_REQUIRED",
} as const;

export type PublishedTargetSessionCookieErrorCode =
  (typeof PublishedTargetSessionCookieErrorCode)[keyof typeof PublishedTargetSessionCookieErrorCode];

type PublishedTargetSessionCookieErrorInput = {
  code: PublishedTargetSessionCookieErrorCode;
  message: string;
  cause?: unknown;
};

export class PublishedTargetSessionCookieError extends Error {
  readonly code: PublishedTargetSessionCookieErrorCode;

  constructor(input: PublishedTargetSessionCookieErrorInput) {
    super(input.message, { cause: input.cause });
    this.name = "PublishedTargetSessionCookieError";
    this.code = input.code;
  }
}

function encodeBase64Url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function decodeBase64Url(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

function readStringProperty(input: object, key: string): string | undefined {
  const value = Reflect.get(input, key);
  return typeof value === "string" ? value : undefined;
}

function readNumberProperty(input: object, key: string): number | undefined {
  const value = Reflect.get(input, key);
  return typeof value === "number" ? value : undefined;
}

function normalizeTargetKind(targetKind: string): "port" {
  if (targetKind !== "port") {
    throw new PublishedTargetSessionCookieError({
      code: PublishedTargetSessionCookieErrorCode.TARGET_KIND_INVALID,
      message: "Published target session cookie targetKind must be 'port'.",
    });
  }

  return "port";
}

function normalizeSessionKind(sessionKind: string): "owned" | "shared" {
  if (sessionKind === "owned" || sessionKind === "shared") {
    return sessionKind;
  }

  throw new PublishedTargetSessionCookieError({
    code: PublishedTargetSessionCookieErrorCode.SESSION_KIND_INVALID,
    message: "Published target session cookie sessionKind must be 'owned' or 'shared'.",
  });
}

function createSignature(input: { cookieSigningSecret: string; encodedPayload: string }): string {
  return createHmac("sha256", input.cookieSigningSecret)
    .update(input.encodedPayload, "utf8")
    .digest("base64url");
}

function normalizeSharedPayload(input: {
  exp: number;
  host: string;
  sandboxInstanceId: string;
  targetId: string;
  targetKind: string;
}): PublishedTargetSessionPayload {
  const normalizedHost = toNonEmptyString(input.host);
  if (normalizedHost === undefined) {
    throw new PublishedTargetSessionCookieError({
      code: PublishedTargetSessionCookieErrorCode.HOST_REQUIRED,
      message: "Published target session cookie host is required.",
    });
  }

  const normalizedSandboxInstanceId = toNonEmptyString(input.sandboxInstanceId);
  if (normalizedSandboxInstanceId === undefined) {
    throw new PublishedTargetSessionCookieError({
      code: PublishedTargetSessionCookieErrorCode.SANDBOX_INSTANCE_ID_REQUIRED,
      message: "Published target session cookie sandboxInstanceId is required.",
    });
  }

  const normalizedTargetId = toNonEmptyString(input.targetId);
  if (normalizedTargetId === undefined) {
    throw new PublishedTargetSessionCookieError({
      code: PublishedTargetSessionCookieErrorCode.TARGET_ID_REQUIRED,
      message: "Published target session cookie targetId is required.",
    });
  }

  if (!Number.isInteger(input.exp) || input.exp < 1) {
    throw new PublishedTargetSessionCookieError({
      code: PublishedTargetSessionCookieErrorCode.INVALID_TTL_SECONDS,
      message: "Published target session cookie exp must be a positive integer.",
    });
  }

  return {
    exp: input.exp,
    host: normalizedHost,
    sandboxInstanceId: normalizedSandboxInstanceId,
    sessionKind: "shared",
    targetId: normalizedTargetId,
    targetKind: normalizeTargetKind(input.targetKind),
  };
}

function normalizeOwnedPayload(input: {
  exp: number;
  host: string;
  organizationId: string;
  sandboxInstanceId: string;
  targetId: string;
  targetKind: string;
  userId: string;
}): PublishedTargetSessionPayload {
  const sharedPayload = normalizeSharedPayload(input);
  const normalizedOrganizationId = toNonEmptyString(input.organizationId);
  if (normalizedOrganizationId === undefined) {
    throw new PublishedTargetSessionCookieError({
      code: PublishedTargetSessionCookieErrorCode.ORGANIZATION_ID_REQUIRED,
      message: "Published target session cookie organizationId is required for owned sessions.",
    });
  }

  const normalizedUserId = toNonEmptyString(input.userId);
  if (normalizedUserId === undefined) {
    throw new PublishedTargetSessionCookieError({
      code: PublishedTargetSessionCookieErrorCode.USER_ID_REQUIRED,
      message: "Published target session cookie userId is required for owned sessions.",
    });
  }

  return {
    ...sharedPayload,
    organizationId: normalizedOrganizationId,
    sessionKind: "owned",
    userId: normalizedUserId,
  };
}

function parsePayload(input: unknown): PublishedTargetSessionPayload {
  if (typeof input !== "object" || input === null) {
    throw new PublishedTargetSessionCookieError({
      code: PublishedTargetSessionCookieErrorCode.COOKIE_INVALID_PAYLOAD,
      message: "Published target session cookie payload must be an object.",
    });
  }

  const sessionKind = normalizeSessionKind(readStringProperty(input, "sessionKind") ?? "");

  if (sessionKind === "owned") {
    return normalizeOwnedPayload({
      exp: readNumberProperty(input, "exp") ?? Number.NaN,
      host: readStringProperty(input, "host") ?? "",
      organizationId: readStringProperty(input, "organizationId") ?? "",
      sandboxInstanceId: readStringProperty(input, "sandboxInstanceId") ?? "",
      targetId: readStringProperty(input, "targetId") ?? "",
      targetKind: readStringProperty(input, "targetKind") ?? "",
      userId: readStringProperty(input, "userId") ?? "",
    });
  }

  return normalizeSharedPayload({
    exp: readNumberProperty(input, "exp") ?? Number.NaN,
    host: readStringProperty(input, "host") ?? "",
    sandboxInstanceId: readStringProperty(input, "sandboxInstanceId") ?? "",
    targetId: readStringProperty(input, "targetId") ?? "",
    targetKind: readStringProperty(input, "targetKind") ?? "",
  });
}

export function mintPublishedTargetSessionCookie(input: {
  config: PublishedTargetSessionCookieConfig;
  host: string;
  organizationId?: string;
  sandboxInstanceId: string;
  sessionKind: "owned" | "shared";
  targetId: string;
  targetKind: "port";
  ttlSeconds: number;
  userId?: string;
}): string {
  if (!Number.isInteger(input.ttlSeconds) || input.ttlSeconds < 1) {
    throw new PublishedTargetSessionCookieError({
      code: PublishedTargetSessionCookieErrorCode.INVALID_TTL_SECONDS,
      message:
        "Published target session cookie ttlSeconds must be an integer greater than or equal to 1.",
    });
  }

  const nowEpochSeconds = Math.floor(Date.now() / 1000);
  const exp = nowEpochSeconds + input.ttlSeconds;

  const payload =
    input.sessionKind === "owned"
      ? normalizeOwnedPayload({
          exp,
          host: input.host,
          organizationId: input.organizationId ?? "",
          sandboxInstanceId: input.sandboxInstanceId,
          targetId: input.targetId,
          targetKind: input.targetKind,
          userId: input.userId ?? "",
        })
      : normalizeSharedPayload({
          exp,
          host: input.host,
          sandboxInstanceId: input.sandboxInstanceId,
          targetId: input.targetId,
          targetKind: input.targetKind,
        });

  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const signature = createSignature({
    cookieSigningSecret: input.config.cookieSigningSecret,
    encodedPayload,
  });

  return `${encodedPayload}.${signature}`;
}

export function verifyPublishedTargetSessionCookie(input: {
  config: PublishedTargetSessionCookieConfig;
  cookie: string;
}): VerifiedPublishedTargetSession {
  const normalizedCookie = toNonEmptyString(input.cookie);
  if (normalizedCookie === undefined) {
    throw new PublishedTargetSessionCookieError({
      code: PublishedTargetSessionCookieErrorCode.COOKIE_REQUIRED,
      message: "Published target session cookie is required.",
    });
  }

  const separatorIndex = normalizedCookie.indexOf(".");
  if (separatorIndex <= 0 || separatorIndex === normalizedCookie.length - 1) {
    throw new PublishedTargetSessionCookieError({
      code: PublishedTargetSessionCookieErrorCode.COOKIE_INVALID_FORMAT,
      message: "Published target session cookie must contain payload and signature segments.",
    });
  }

  const encodedPayload = normalizedCookie.slice(0, separatorIndex);
  const providedSignature = normalizedCookie.slice(separatorIndex + 1);
  const expectedSignature = createSignature({
    cookieSigningSecret: input.config.cookieSigningSecret,
    encodedPayload,
  });
  const providedSignatureBuffer = Buffer.from(providedSignature, "utf8");
  const expectedSignatureBuffer = Buffer.from(expectedSignature, "utf8");

  if (
    providedSignatureBuffer.length !== expectedSignatureBuffer.length ||
    !timingSafeEqual(providedSignatureBuffer, expectedSignatureBuffer)
  ) {
    throw new PublishedTargetSessionCookieError({
      code: PublishedTargetSessionCookieErrorCode.COOKIE_INVALID_SIGNATURE,
      message: "Published target session cookie signature is invalid.",
    });
  }

  let decodedPayloadText: string;
  try {
    decodedPayloadText = decodeBase64Url(encodedPayload);
  } catch (error) {
    throw new PublishedTargetSessionCookieError({
      code: PublishedTargetSessionCookieErrorCode.COOKIE_INVALID_FORMAT,
      message: "Published target session cookie payload is not valid base64url.",
      cause: error,
    });
  }

  let decodedPayload: unknown;
  try {
    decodedPayload = JSON.parse(decodedPayloadText);
  } catch (error) {
    throw new PublishedTargetSessionCookieError({
      code: PublishedTargetSessionCookieErrorCode.COOKIE_INVALID_PAYLOAD,
      message: "Published target session cookie payload is not valid JSON.",
      cause: error,
    });
  }

  const payload = parsePayload(decodedPayload);
  if (payload.exp < Math.floor(Date.now() / 1000)) {
    throw new PublishedTargetSessionCookieError({
      code: PublishedTargetSessionCookieErrorCode.COOKIE_EXPIRED,
      message: "Published target session cookie is expired.",
    });
  }

  if (payload.sessionKind === "owned") {
    return {
      host: payload.host,
      organizationId: payload.organizationId,
      sandboxInstanceId: payload.sandboxInstanceId,
      sessionKind: payload.sessionKind,
      targetId: payload.targetId,
      targetKind: payload.targetKind,
      userId: payload.userId,
    };
  }

  return {
    host: payload.host,
    sandboxInstanceId: payload.sandboxInstanceId,
    sessionKind: payload.sessionKind,
    targetId: payload.targetId,
    targetKind: payload.targetKind,
  };
}
