import { describe, expect, it } from "vitest";

import {
  mintPublishedTargetSessionCookie,
  PublishedTargetSessionCookieError,
  PublishedTargetSessionCookieErrorCode,
  verifyPublishedTargetSessionCookie,
  type PublishedTargetSessionCookieConfig,
} from "./published-target-session-cookie.js";

const defaultConfig: PublishedTargetSessionCookieConfig = {
  cookieSigningSecret: "published-target-session-secret",
};

async function expectPublishedTargetSessionCookieError(
  callback: () => unknown,
): Promise<PublishedTargetSessionCookieError> {
  try {
    await callback();
  } catch (error) {
    if (error instanceof PublishedTargetSessionCookieError) {
      return error;
    }

    throw error;
  }

  throw new Error("Expected callback to throw PublishedTargetSessionCookieError.");
}

describe("@mistle/gateway-published-target-auth published target session cookie", () => {
  it("mints and verifies an owned session cookie", () => {
    const cookie = mintPublishedTargetSessionCookie({
      config: defaultConfig,
      host: "p-5173--sbi-roundtrip-001.mistle.localhost",
      organizationId: "org_123",
      sandboxInstanceId: "sbi_roundtrip_001",
      sessionKind: "owned",
      targetId: "5173",
      targetKind: "port",
      ttlSeconds: 60,
      userId: "usr_123",
    });

    expect(
      verifyPublishedTargetSessionCookie({
        config: defaultConfig,
        cookie,
      }),
    ).toEqual({
      host: "p-5173--sbi-roundtrip-001.mistle.localhost",
      organizationId: "org_123",
      sandboxInstanceId: "sbi_roundtrip_001",
      sessionKind: "owned",
      targetId: "5173",
      targetKind: "port",
      userId: "usr_123",
    });
  });

  it("mints and verifies a shared session cookie", () => {
    const cookie = mintPublishedTargetSessionCookie({
      config: defaultConfig,
      host: "p-5173--sbi-roundtrip-001.mistle.localhost",
      sandboxInstanceId: "sbi_roundtrip_001",
      sessionKind: "shared",
      targetId: "5173",
      targetKind: "port",
      ttlSeconds: 60,
    });

    expect(
      verifyPublishedTargetSessionCookie({
        config: defaultConfig,
        cookie,
      }),
    ).toEqual({
      host: "p-5173--sbi-roundtrip-001.mistle.localhost",
      sandboxInstanceId: "sbi_roundtrip_001",
      sessionKind: "shared",
      targetId: "5173",
      targetKind: "port",
    });
  });

  it("rejects owned session cookies that omit organizationId", async () => {
    const error = await expectPublishedTargetSessionCookieError(() =>
      mintPublishedTargetSessionCookie({
        config: defaultConfig,
        host: "p-5173--sbi-roundtrip-001.mistle.localhost",
        organizationId: "   ",
        sandboxInstanceId: "sbi_roundtrip_001",
        sessionKind: "owned",
        targetId: "5173",
        targetKind: "port",
        ttlSeconds: 60,
        userId: "usr_123",
      }),
    );

    expect(error.code).toBe(PublishedTargetSessionCookieErrorCode.ORGANIZATION_ID_REQUIRED);
  });

  it("rejects tampered cookies", async () => {
    const cookie = mintPublishedTargetSessionCookie({
      config: defaultConfig,
      host: "p-5173--sbi-roundtrip-001.mistle.localhost",
      sandboxInstanceId: "sbi_roundtrip_001",
      sessionKind: "shared",
      targetId: "5173",
      targetKind: "port",
      ttlSeconds: 60,
    });

    const error = await expectPublishedTargetSessionCookieError(() =>
      verifyPublishedTargetSessionCookie({
        config: defaultConfig,
        cookie: `${cookie}tampered`,
      }),
    );

    expect(error.code).toBe(PublishedTargetSessionCookieErrorCode.COOKIE_INVALID_SIGNATURE);
  });
});
