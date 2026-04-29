import { describe, expect } from "vitest";

import { authMethodsResponseSchema } from "../src/auth/get-auth-methods/index.js";
import { it } from "./test-context.js";

describe("auth methods integration", () => {
  it("returns public dashboard auth method availability", async ({ fixture }) => {
    const response = await fixture.request("/v1/auth/methods");

    expect(response.status).toBe(200);
    expect(authMethodsResponseSchema.parse(await response.json())).toStrictEqual({
      methods: {
        emailOtp: true,
        google: false,
      },
    });
  });
});
