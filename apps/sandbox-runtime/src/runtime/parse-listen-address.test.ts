import { describe, expect, it } from "vitest";

import { parseListenAddress } from "./parse-listen-address.js";

describe("parseListenAddress", () => {
  it("parses port-only listen addresses", () => {
    expect(parseListenAddress(":8080")).toEqual({ port: 8080 });
  });

  it("parses host and port listen addresses", () => {
    expect(parseListenAddress("127.0.0.1:8080")).toEqual({
      host: "127.0.0.1",
      port: 8080,
    });
  });

  it("rejects malformed listen addresses", () => {
    expect(() => parseListenAddress("127.0.0.1")).toThrow("invalid listen addr 127.0.0.1");
    expect(() => parseListenAddress("127.0.0.1:")).toThrow("invalid listen addr 127.0.0.1:");
    expect(() => parseListenAddress(":70000")).toThrow("invalid listen addr :70000");
  });
});
