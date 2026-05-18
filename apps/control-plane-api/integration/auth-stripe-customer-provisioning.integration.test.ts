/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import {
  BillingCustomerProviders,
  OrganizationBillingCustomerStatuses,
} from "@mistle/db/control-plane";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import {
  createStripeCustomerProvisioningIdempotencyKey,
  ProvisionStripeCustomerWorkflowSpec,
} from "@mistle/workflow-registry/control-plane";
import { describe, expect } from "vitest";

import { countQueuedControlPlaneWorkflowRunsByIdempotencyKeyForIntegrationTest } from "./test-helpers/control-plane-workflow-runs.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
  __serviceOptions: {
    controlPlaneApi: {
      billingStripeEnabled: true,
    },
  },
});

describe.concurrent("auth Stripe customer provisioning integration", () => {
  it("enqueues Stripe customer provisioning when Better Auth creates an organization", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-stripe-provisioning@example.com",
      organizationName: "Stripe Provisioning Integration",
    });

    const billingCustomers = await env.controlPlaneDb.query.organizationBillingCustomers.findMany({
      columns: {
        organizationId: true,
        provider: true,
        status: true,
      },
      where: (table, { and, eq }) =>
        and(
          eq(table.organizationId, session.organizationId),
          eq(table.provider, BillingCustomerProviders.STRIPE),
        ),
    });

    expect(billingCustomers).toEqual([
      {
        organizationId: session.organizationId,
        provider: BillingCustomerProviders.STRIPE,
        status: OrganizationBillingCustomerStatuses.PROVISIONING,
      },
    ]);
    await expect(
      countQueuedControlPlaneWorkflowRunsByIdempotencyKeyForIntegrationTest({
        env,
        workflowName: ProvisionStripeCustomerWorkflowSpec.name,
        idempotencyKey: createStripeCustomerProvisioningIdempotencyKey(session.organizationId),
      }),
    ).resolves.toBe(1);
  });
});
