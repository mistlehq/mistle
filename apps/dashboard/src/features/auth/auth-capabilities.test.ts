import { describe, expect, it } from "vitest";

import { parseAuthCapabilities } from "./auth-capabilities.js";

describe("parseAuthCapabilities", () => {
  it("parses supported sign-in methods", () => {
    expect(
      parseAuthCapabilities({
        methods: {
          emailOtp: true,
          google: false,
        },
      }),
    ).toEqual({
      methods: {
        emailOtp: true,
        google: false,
      },
    });
  });

  it("rejects invalid capability payloads", () => {
    expect(() =>
      parseAuthCapabilities({
        methods: {
          emailOtp: true,
        },
      }),
    ).toThrow("google");
  });
});
