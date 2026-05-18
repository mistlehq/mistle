/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { createIntegrationTest } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import { dashboardCapabilitiesResponseSchema } from "../src/dashboard/get-capabilities/index.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("dashboard capabilities integration", () => {
  it("omits billing capability when Stripe billing is disabled", async ({ env }) => {
    const response = await env.controlPlaneApi.http.fetch("/v1/dashboard/capabilities");

    expect(response.status).toBe(200);
    expect(dashboardCapabilitiesResponseSchema.parse(await response.json())).toStrictEqual({});
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

describe.concurrent("dashboard capabilities with Stripe billing integration", () => {
  stripeBillingEnabledIt(
    "returns billing capability only when Stripe billing is enabled",
    async ({ env }) => {
      const response = await env.controlPlaneApi.http.fetch("/v1/dashboard/capabilities");

      expect(response.status).toBe(200);
      expect(dashboardCapabilitiesResponseSchema.parse(await response.json())).toStrictEqual({
        billing: {
          stripe: {
            enabled: true,
          },
        },
      });
    },
  );
});
