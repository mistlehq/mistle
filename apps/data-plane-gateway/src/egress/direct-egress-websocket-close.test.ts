import { describe, expect, it } from "vitest";

import {
  normalizeForwardedDirectEgressWebSocketCloseCode,
  normalizeForwardedDirectEgressWebSocketCloseReason,
} from "./direct-egress-websocket-close.js";

describe("normalizeForwardedDirectEgressWebSocketCloseCode", () => {
  it("maps unsendable upstream websocket close codes to an internal error close", () => {
    expect(normalizeForwardedDirectEgressWebSocketCloseCode(999)).toBe(1011);
    expect(normalizeForwardedDirectEgressWebSocketCloseCode(1005)).toBe(1011);
    expect(normalizeForwardedDirectEgressWebSocketCloseCode(1006)).toBe(1011);
    expect(normalizeForwardedDirectEgressWebSocketCloseCode(5000)).toBe(1011);
  });

  it("preserves sendable upstream websocket close codes", () => {
    expect(normalizeForwardedDirectEgressWebSocketCloseCode(1000)).toBe(1000);
    expect(normalizeForwardedDirectEgressWebSocketCloseCode(1008)).toBe(1008);
    expect(normalizeForwardedDirectEgressWebSocketCloseCode(4999)).toBe(4999);
  });
});

describe("normalizeForwardedDirectEgressWebSocketCloseReason", () => {
  it("preserves close reasons that fit in a websocket close frame", () => {
    expect(normalizeForwardedDirectEgressWebSocketCloseReason("upstream closed")).toBe(
      "upstream closed",
    );
  });

  it("truncates long close reasons without splitting multibyte characters", () => {
    const normalized = normalizeForwardedDirectEgressWebSocketCloseReason(`${"a".repeat(122)}é`);

    expect(Buffer.byteLength(normalized)).toBe(122);
    expect(normalized).toBe("a".repeat(122));
  });
});
