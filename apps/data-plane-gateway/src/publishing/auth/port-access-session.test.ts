import { createMutableClock } from "@mistle/time/testing";
import { describe, expect, it } from "vitest";

import {
  createPortAccessSessionSetCookieHeader,
  mintPortAccessSession,
  PortAccessSessionCookieName,
  PortAccessSessionError,
  PortAccessSessionErrorCode,
  PortAccessSessionTtlSeconds,
  verifyPortAccessSession,
} from "./port-access-session.js";

const SessionConfig = {
  cookieSigningSecret: "port-access-session-cookie-secret",
};

describe("port access session", () => {
  it("mints and verifies a session cookie token", async () => {
    const clock = createMutableClock(1_700_000_000_000);
    const token = await mintPortAccessSession({
      config: SessionConfig,
      clock,
      sandboxInstanceId: "sbi_session_roundtrip",
      port: 5173,
      host: "p-5173--onrgsx3sn52w4zduojuxaxzqgayq.mistle.localhost",
      upstreamProtocol: "https",
    });

    await expect(
      verifyPortAccessSession({
        config: SessionConfig,
        clock,
        cookie: token,
      }),
    ).resolves.toEqual({
      sandboxInstanceId: "sbi_session_roundtrip",
      port: 5173,
      host: "p-5173--onrgsx3sn52w4zduojuxaxzqgayq.mistle.localhost",
      upstreamProtocol: "https",
    });
  });

  it("rejects expired session cookie tokens", async () => {
    const clock = createMutableClock(1_700_000_000_000);
    const token = await mintPortAccessSession({
      config: SessionConfig,
      clock,
      sandboxInstanceId: "sbi_session_expired",
      port: 3000,
      host: "p-3000--onrgsx3sn52w4zduojuxaxzqgayq.mistle.localhost",
      upstreamProtocol: "http",
    });

    clock.advanceMs((PortAccessSessionTtlSeconds + 1) * 1000);

    await expect(
      verifyPortAccessSession({
        config: SessionConfig,
        clock,
        cookie: token,
      }),
    ).rejects.toMatchObject({
      code: PortAccessSessionErrorCode.COOKIE_EXPIRED,
    } satisfies Pick<PortAccessSessionError, "code">);
  });

  it("serializes the required host-only set-cookie attributes", () => {
    const header = createPortAccessSessionSetCookieHeader({
      token: "session-token",
      secure: false,
    });

    expect(header).toContain(`${PortAccessSessionCookieName}=session-token`);
    expect(header).toContain(`Max-Age=${String(PortAccessSessionTtlSeconds)}`);
    expect(header).toContain("Path=/");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).not.toContain("Domain=");
    expect(header).not.toContain("Secure");
  });

  it("includes Secure for https-served access hosts", () => {
    const header = createPortAccessSessionSetCookieHeader({
      token: "session-token",
      secure: true,
    });

    expect(header).toContain("Secure");
  });
});
