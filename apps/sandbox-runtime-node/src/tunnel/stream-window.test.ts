import { describe, expect, it } from "vitest";

import { StreamSendWindow } from "./stream-window.js";

describe("StreamSendWindow", () => {
  it("consumes available bytes", () => {
    const window = new StreamSendWindow(10);

    expect(window.tryConsume(4)).toBe(true);
    expect(window.tryConsume(7)).toBe(false);
    expect(window.tryConsume(6)).toBe(true);
  });

  it("rejects invalid additional credit", () => {
    const window = new StreamSendWindow(1);

    expect(() => window.add(0)).toThrow("stream.window bytes must be a positive integer");
  });
});
