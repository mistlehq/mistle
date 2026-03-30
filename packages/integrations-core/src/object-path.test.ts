import { describe, expect, it } from "vitest";

import { assertSafeObjectPath } from "./object-path.js";

describe("assertSafeObjectPath", () => {
  it("accepts ordinary object paths", () => {
    expect(() => {
      assertSafeObjectPath(["mcpServers", "linear"], "path is invalid");
    }).not.toThrow();
  });

  it("rejects prototype-mutating object paths", () => {
    expect(() => {
      assertSafeObjectPath(["constructor", "prototype", "polluted"], "path is invalid");
    }).toThrow("path is invalid");
  });
});
