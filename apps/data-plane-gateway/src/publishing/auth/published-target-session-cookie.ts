import { createHmac, timingSafeEqual } from "node:crypto";

type PublishedTargetSessionCookieConfig = {
  cookieSigningSecret: string;
};

type VerifiedPublishedTargetSession =
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

const PublishedTargetSessionCookieName = "mistle_published_target_session";
const LocalPublishedBaseDomain = "mistle.localhost";

class PublishedTargetSessionCookieError extends Error {
  public constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PublishedTargetSessionCookieError";
  }
}

export class PublishedTargetRequestCookieError extends Error {
  public constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PublishedTargetRequestCookieError";
  }
}

function toNonEmptyString(value: string | undefined): string {
  if (value === undefined) {
    throw new PublishedTargetSessionCookieError("Expected a non-empty string.");
  }

  const trimmedValue = value.trim();
  if (trimmedValue.length === 0) {
    throw new PublishedTargetSessionCookieError("Expected a non-empty string.");
  }

  return trimmedValue;
}

function encodeBase64Url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function decodeBase64Url(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

function createSignature(input: {
  cookieSigningSecret: string;
  encodedPayload: string;
}): string {
  return createHmac("sha256", input.cookieSigningSecret)
    .update(input.encodedPayload, "utf8")
    .digest("base64url");
}

function createSetCookieHeader(input: {
  maxAgeSeconds: number;
  name: string;
  secure: boolean;
  value: string;
}): string {
  const parts = [
    `${input.name}=${input.value}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${String(input.maxAgeSeconds)}`,
  ];

  if (input.secure) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

function parseCookieHeader(cookieHeader: string): Map<string, string> {
  const cookies = new Map<string, string>();

  for (const segment of cookieHeader.split(";")) {
    const trimmedSegment = segment.trim();
    if (trimmedSegment.length === 0) {
      continue;
    }

    const separatorIndex = trimmedSegment.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const name = trimmedSegment.slice(0, separatorIndex).trim();
    const value = trimmedSegment.slice(separatorIndex + 1).trim();
    if (name.length === 0 || value.length === 0) {
      continue;
    }

    cookies.set(name, value);
  }

  return cookies;
}

function readStringProperty(input: object, key: string): string | undefined {
  const value = Reflect.get(input, key);
  return typeof value === "string" ? value : undefined;
}

function readNumberProperty(input: object, key: string): number | undefined {
  const value = Reflect.get(input, key);
  return typeof value === "number" ? value : undefined;
}

function parsePayload(value: unknown): VerifiedPublishedTargetSession & {
  exp: number;
} {
  if (typeof value !== "object" || value === null) {
    throw new PublishedTargetSessionCookieError(
      "Published target session cookie payload must be an object.",
    );
  }

  const exp = readNumberProperty(value, "exp");
  if (exp === undefined || !Number.isInteger(exp) || exp < 1) {
    throw new PublishedTargetSessionCookieError(
      "Published target session cookie exp must be a positive integer.",
    );
  }

  const host = toNonEmptyString(readStringProperty(value, "host"));
  const sandboxInstanceId = toNonEmptyString(
    readStringProperty(value, "sandboxInstanceId"),
  );
  const targetId = toNonEmptyString(readStringProperty(value, "targetId"));
  const targetKind = readStringProperty(value, "targetKind");
  if (targetKind !== "port") {
    throw new PublishedTargetSessionCookieError(
      "Published target session cookie targetKind must be 'port'.",
    );
  }

  const sessionKind = readStringProperty(value, "sessionKind");
  if (sessionKind === "owned") {
    return {
      exp,
      host,
      organizationId: toNonEmptyString(
        readStringProperty(value, "organizationId"),
      ),
      sandboxInstanceId,
      sessionKind,
      targetId,
      targetKind,
      userId: toNonEmptyString(readStringProperty(value, "userId")),
    };
  }

  if (sessionKind === "shared") {
    return {
      exp,
      host,
      sandboxInstanceId,
      sessionKind,
      targetId,
      targetKind,
    };
  }

  throw new PublishedTargetSessionCookieError(
    "Published target session cookie sessionKind must be 'owned' or 'shared'.",
  );
}

function mintPublishedTargetSessionCookie(input: {
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
    throw new PublishedTargetSessionCookieError(
      "Published target session cookie ttlSeconds must be a positive integer.",
    );
  }

  const expiresAtEpochSeconds = Math.floor(Date.now() / 1000) + input.ttlSeconds;
  const payload: {
    exp: number;
    host: string;
    organizationId?: string;
    sandboxInstanceId: string;
    sessionKind: "owned" | "shared";
    targetId: string;
    targetKind: "port";
    userId?: string;
  } =
    input.sessionKind === "owned"
      ? {
          exp: expiresAtEpochSeconds,
          host: toNonEmptyString(input.host),
          organizationId: toNonEmptyString(input.organizationId),
          sandboxInstanceId: toNonEmptyString(input.sandboxInstanceId),
          sessionKind: "owned",
          targetId: toNonEmptyString(input.targetId),
          targetKind: "port",
          userId: toNonEmptyString(input.userId),
        }
      : {
          exp: expiresAtEpochSeconds,
          host: toNonEmptyString(input.host),
          sandboxInstanceId: toNonEmptyString(input.sandboxInstanceId),
          sessionKind: "shared",
          targetId: toNonEmptyString(input.targetId),
          targetKind: "port",
        };

  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const signature = createSignature({
    cookieSigningSecret: input.config.cookieSigningSecret,
    encodedPayload,
  });

  return `${encodedPayload}.${signature}`;
}

function verifyPublishedTargetSessionCookie(input: {
  config: PublishedTargetSessionCookieConfig;
  cookie: string;
}): VerifiedPublishedTargetSession {
  const trimmedCookie = input.cookie.trim();
  if (trimmedCookie.length === 0) {
    throw new PublishedTargetSessionCookieError("Published target session cookie is required.");
  }

  const separatorIndex = trimmedCookie.indexOf(".");
  if (separatorIndex <= 0 || separatorIndex === trimmedCookie.length - 1) {
    throw new PublishedTargetSessionCookieError(
      "Published target session cookie format is invalid.",
    );
  }

  const encodedPayload = trimmedCookie.slice(0, separatorIndex);
  const signature = trimmedCookie.slice(separatorIndex + 1);
  const expectedSignature = createSignature({
    cookieSigningSecret: input.config.cookieSigningSecret,
    encodedPayload,
  });

  const actualSignatureBuffer = Buffer.from(signature, "utf8");
  const expectedSignatureBuffer = Buffer.from(expectedSignature, "utf8");
  if (
    actualSignatureBuffer.length !== expectedSignatureBuffer.length ||
    !timingSafeEqual(actualSignatureBuffer, expectedSignatureBuffer)
  ) {
    throw new PublishedTargetSessionCookieError(
      "Published target session cookie signature is invalid.",
    );
  }

  let payload: VerifiedPublishedTargetSession & { exp: number };
  try {
    const decodedPayload = JSON.parse(decodeBase64Url(encodedPayload));
    payload = parsePayload(decodedPayload);
  } catch (error) {
    if (error instanceof PublishedTargetSessionCookieError) {
      throw error;
    }

    throw new PublishedTargetSessionCookieError(
      "Published target session cookie payload is invalid.",
      { cause: error },
    );
  }

  if (payload.exp <= Math.floor(Date.now() / 1000)) {
    throw new PublishedTargetSessionCookieError("Published target session cookie is expired.");
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

export function shouldUseSecurePublishedTargetSessionCookie(input: {
  baseDomain: string;
  environment: "development" | "production";
}): boolean {
  return !(input.environment === "development" && input.baseDomain === LocalPublishedBaseDomain);
}

export function mintPublishedTargetSessionSetCookieHeader(input: {
  baseDomain: string;
  config: PublishedTargetSessionCookieConfig;
  environment: "development" | "production";
  host: string;
  maxAgeSeconds: number;
  session:
    | {
        sessionKind: "owned";
        organizationId: string;
        sandboxInstanceId: string;
        targetId: string;
        targetKind: "port";
        userId: string;
      }
    | {
        sessionKind: "shared";
        sandboxInstanceId: string;
        targetId: string;
        targetKind: "port";
      };
}): string {
  const cookieValue = mintPublishedTargetSessionCookie({
    config: input.config,
    host: input.host,
    sandboxInstanceId: input.session.sandboxInstanceId,
    sessionKind: input.session.sessionKind,
    targetId: input.session.targetId,
    targetKind: input.session.targetKind,
    ttlSeconds: input.maxAgeSeconds,
    ...(input.session.sessionKind === "owned"
      ? {
          organizationId: input.session.organizationId,
          userId: input.session.userId,
        }
      : {}),
  });

  return createSetCookieHeader({
    maxAgeSeconds: input.maxAgeSeconds,
    name: PublishedTargetSessionCookieName,
    secure: shouldUseSecurePublishedTargetSessionCookie({
      baseDomain: input.baseDomain,
      environment: input.environment,
    }),
    value: cookieValue,
  });
}

export function verifyPublishedTargetSessionFromCookieHeader(input: {
  config: PublishedTargetSessionCookieConfig;
  cookieHeader: string | undefined;
  expectedHost: string;
}): VerifiedPublishedTargetSession {
  if (input.cookieHeader === undefined || input.cookieHeader.trim().length === 0) {
    throw new PublishedTargetRequestCookieError("Published target session cookie is required.");
  }

  const cookieValue = parseCookieHeader(input.cookieHeader).get(PublishedTargetSessionCookieName);
  if (cookieValue === undefined) {
    throw new PublishedTargetRequestCookieError("Published target session cookie is required.");
  }

  let session: VerifiedPublishedTargetSession;
  try {
    session = verifyPublishedTargetSessionCookie({
      config: input.config,
      cookie: cookieValue,
    });
  } catch (error) {
    if (error instanceof PublishedTargetSessionCookieError) {
      throw new PublishedTargetRequestCookieError(error.message, { cause: error });
    }

    throw error;
  }

  if (session.host !== input.expectedHost) {
    throw new PublishedTargetRequestCookieError(
      "Published target session cookie host does not match the current host.",
    );
  }

  return session;
}

export { PublishedTargetSessionCookieName };
