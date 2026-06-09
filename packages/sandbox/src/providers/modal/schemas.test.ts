import { describe, expect, it } from "vitest";

import { validateModalStartResources } from "./schemas.js";

describe("validateModalStartResources", () => {
  it("accepts CPU and memory resources without disk", () => {
    expect(() =>
      validateModalStartResources({
        diskMb: undefined,
      }),
    ).not.toThrow();
  });

  it("rejects disk resources because Modal sandbox creation does not expose disk sizing", () => {
    expect(() =>
      validateModalStartResources({
        diskMb: 10_240,
      }),
    ).toThrow("Modal sandbox runtime does not support configurable disk.");
  });
});
