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

  it("rejects missing, mismatched, different-length, and unicode-equivalent-looking tokens", () => {
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
    expect(
      isInternalServiceTokenValid({
        providedToken: "servic\u{00e9}-token",
        expectedToken: "service-token",
      }),
    ).toBe(false);
  });
});
