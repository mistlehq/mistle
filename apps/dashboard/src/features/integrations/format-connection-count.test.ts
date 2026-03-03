import { describe, expect, it } from "vitest";

import { formatConnectionCount } from "./format-connection-count.js";

describe("formatConnectionCount", () => {
  it("formats singular count", () => {
    expect(formatConnectionCount(1)).toBe("1 connection");
  });

  it("formats plural counts", () => {
    expect(formatConnectionCount(0)).toBe("0 connections");
    expect(formatConnectionCount(2)).toBe("2 connections");
  });

  it("throws on invalid counts", () => {
    expect(() => formatConnectionCount(-1)).toThrow(
      "Connection count must be a non-negative integer. Received '-1'.",
    );
    expect(() => formatConnectionCount(1.5)).toThrow(
      "Connection count must be a non-negative integer. Received '1.5'.",
    );
  });
});
