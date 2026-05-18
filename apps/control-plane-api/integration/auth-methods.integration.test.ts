/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { createIntegrationTest } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import { authMethodsResponseSchema } from "../src/auth/get-auth-methods/index.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("auth methods integration", () => {
  it("returns public dashboard auth method availability", async ({ env }) => {
    const response = await env.controlPlaneApi.http.fetch("/v1/auth/methods");

    expect(response.status).toBe(200);
    expect(authMethodsResponseSchema.parse(await response.json())).toStrictEqual({
      methods: {
        emailOtp: true,
        google: false,
      },
      allowSignups: true,
    });
  });
});

const stripeBillingEnabledIt = createIntegrationTest({
  services: ["control-plane-api"],
  __serviceOptions: {
    controlPlaneApi: {
      billingStripeEnabled: true,
    },
  },
});

describe.concurrent("auth methods with Stripe billing integration", () => {
  stripeBillingEnabledIt("keeps auth methods scoped to auth-only metadata", async ({ env }) => {
    const response = await env.controlPlaneApi.http.fetch("/v1/auth/methods");

    expect(response.status).toBe(200);
    expect(authMethodsResponseSchema.parse(await response.json())).toStrictEqual({
      methods: {
        emailOtp: true,
        google: false,
      },
      allowSignups: true,
    });
  });
});

const signupsDisabledIt = createIntegrationTest({
  services: ["control-plane-api"],
  __serviceOptions: {
    controlPlaneApi: {
      allowSignups: false,
    },
  },
});

describe.concurrent("auth methods with disabled signups integration", () => {
  signupsDisabledIt("returns signup allowance metadata", async ({ env }) => {
    const response = await env.controlPlaneApi.http.fetch("/v1/auth/methods");

    expect(response.status).toBe(200);
    expect(authMethodsResponseSchema.parse(await response.json())).toStrictEqual({
      methods: {
        emailOtp: true,
        google: false,
      },
      allowSignups: false,
    });
  });
});
