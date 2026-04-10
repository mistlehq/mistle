import { describe, expect, it } from "vitest";

import {
  mintPublishedPortSessionCookieValue,
  serializePublishedPortSessionSetCookie,
  verifyPublishedPortSessionCookieValue,
} from "./published-port-session.js";

describe("published port session cookie", () => {
  it("round trips a signed session payload", () => {
    const cookieValue = mintPublishedPortSessionCookieValue({
      cookieSigningSecret: "integration-publish-cookie-secret",
      expiresAtEpochSeconds: Math.floor(Date.now() / 1000) + 600,
      host: "p-5173--example.mistle.example.test",
      sandboxInstanceId: "sbi_roundtrip_001",
      port: 5173,
      protocol: "http",
      websocketCapable: true,
    });

    expect(
      verifyPublishedPortSessionCookieValue({
        cookieSigningSecret: "integration-publish-cookie-secret",
        cookieValue,
      }),
    ).toEqual({
      host: "p-5173--example.mistle.example.test",
      sandboxInstanceId: "sbi_roundtrip_001",
      port: 5173,
      protocol: "http",
      websocketCapable: true,
      expiresAtEpochSeconds: expect.any(Number),
    });
  });

  it("serializes a host-scoped set-cookie value", () => {
    expect(
      serializePublishedPortSessionSetCookie({
        cookieValue: "payload.signature",
        expiresAtEpochSeconds: Math.floor(Date.now() / 1000) + 600,
        isSecure: true,
      }),
    ).toContain("mistle_published_port_session=payload.signature");
  });
});
