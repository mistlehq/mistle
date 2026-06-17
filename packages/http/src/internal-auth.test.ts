import { describe, expect, it } from "vitest";

import { isInternalServiceTokenValid } from "./internal-auth.js";

describe("isInternalServiceTokenValid", () => {
  it("accepts matching tokens", () => {
    expect(
      isInternalServiceTokenValid({
        providedToken: "service-token",
        expectedToken: "service-token",
      }),
    ).toBe(true);
  });

  it("rejects missing, mismatched, and different-length tokens", () => {
    expect(
      isInternalServiceTokenValid({
        providedToken: undefined,
        expectedToken: "service-token",
      }),
    ).toBe(false);
    expect(
      isInternalServiceTokenValid({
        providedToken: "service-token-x",
        expectedToken: "service-token",
      }),
    ).toBe(false);
    expect(
      isInternalServiceTokenValid({
        providedToken: "service-tokem",
        expectedToken: "service-token",
      }),
    ).toBe(false);
  });
});
