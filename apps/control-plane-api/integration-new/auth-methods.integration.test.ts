/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { createIntegrationTest } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import { authMethodsResponseSchema } from "../src/auth/get-auth-methods/index.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe("auth methods integration", () => {
  it("returns public dashboard auth method availability", async ({ env }) => {
    const response = await env.controlPlaneApi.http.fetch("/v1/auth/methods");

    expect(response.status).toBe(200);
    expect(authMethodsResponseSchema.parse(await response.json())).toStrictEqual({
      methods: {
        emailOtp: true,
        google: false,
      },
    });
  });
});
