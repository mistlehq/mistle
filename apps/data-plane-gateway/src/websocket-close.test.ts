import { describe, expect, it } from "vitest";

import { normalizeWebSocketCloseReason } from "./websocket-close.js";

describe("normalizeWebSocketCloseReason", () => {
  it("preserves close reasons that fit in a websocket close frame", () => {
    expect(normalizeWebSocketCloseReason("upstream closed")).toBe("upstream closed");
  });

  it("truncates long close reasons to the websocket close frame byte limit", () => {
    const normalized = normalizeWebSocketCloseReason("x".repeat(124));

    expect(Buffer.byteLength(normalized)).toBe(123);
    expect(normalized).toBe("x".repeat(123));
  });

  it("does not split multibyte characters while truncating", () => {
    const normalized = normalizeWebSocketCloseReason(`${"a".repeat(122)}é`);

    expect(Buffer.byteLength(normalized)).toBe(122);
    expect(normalized).toBe("a".repeat(122));
  });
});
