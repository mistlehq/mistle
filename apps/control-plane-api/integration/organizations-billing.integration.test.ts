/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import {
  BillingCustomerProviders,
  OrganizationBillingCustomerStatuses,
} from "@mistle/db/control-plane";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import type { IntegrationTestEnvironment } from "@mistle/test-harness/integration";
import {
  createStripeCustomerProvisioningIdempotencyKey,
  ProvisionStripeCustomerWorkflowSpec,
} from "@mistle/workflow-registry/control-plane";
import { eq } from "drizzle-orm";
import { describe, expect } from "vitest";

import { OrganizationBillingResponseSchema } from "../src/organizations/get-billing/index.js";
import { countQueuedControlPlaneWorkflowRunsByIdempotencyKeyForIntegrationTest } from "./test-helpers/control-plane-workflow-runs.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
  __serviceOptions: {
    controlPlaneApi: {
      billingStripeEnabled: true,
    },
  },
});

describe.concurrent("organization billing integration", () => {
  it("returns unavailable billing information until the Stripe customer is active", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-organization-billing-unavailable@example.com",
      organizationName: "Billing Unavailable Integration",
    });

    const response = await getOrganizationBilling({
      cookie: session.cookie,
      env,
    });

    expect(response.status).toBe(200);
    expect(OrganizationBillingResponseSchema.parse(await response.json())).toEqual({
      available: false,
    });
  });

  it("returns active billing details without exposing provisioning state", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-organization-billing-active@example.com",
      organizationName: "Billing Active Integration",
    });

    await env.controlPlaneDb
      .update(env.controlPlaneTables.organizationBillingCustomers)
      .set({
        providerCustomerId: "cus_integration_active",
        status: OrganizationBillingCustomerStatuses.ACTIVE,
      })
      .where(
        eq(
          env.controlPlaneTables.organizationBillingCustomers.organizationId,
          session.organizationId,
        ),
      );

    const response = await getOrganizationBilling({
      cookie: session.cookie,
      env,
    });

    expect(response.status).toBe(200);
    expect(OrganizationBillingResponseSchema.parse(await response.json())).toEqual({
      available: true,
      organization: {
        name: "Billing Active Integration",
        stripeCustomerId: "cus_integration_active",
      },
    });
  });

  it("ensures billing customer provisioning through an explicit idempotent mutation", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-organization-billing-ensure@example.com",
      organizationName: "Billing Ensure Integration",
    });

    const firstResponse = await ensureOrganizationBillingCustomer({
      cookie: session.cookie,
      env,
    });
    const secondResponse = await ensureOrganizationBillingCustomer({
      cookie: session.cookie,
      env,
    });

    expect(firstResponse.status).toBe(200);
    expect(OrganizationBillingResponseSchema.parse(await firstResponse.json())).toEqual({
      available: false,
    });
    expect(secondResponse.status).toBe(200);
    expect(OrganizationBillingResponseSchema.parse(await secondResponse.json())).toEqual({
      available: false,
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

  it("rejects billing access for organization members", async ({ env }) => {
    const ownerSession = await env.auth.createSession({
      email: "integration-organization-billing-owner@example.com",
      organizationName: "Billing Authorization Integration",
    });
    const memberSession = await env.auth.createSession({
      email: "integration-organization-billing-member@example.com",
    });
    await addMemberToActiveOrganization({
      env,
      organizationId: ownerSession.organizationId,
      userId: memberSession.userId,
    });

    const response = await getOrganizationBilling({
      cookie: memberSession.cookie,
      env,
    });
    const ensureResponse = await ensureOrganizationBillingCustomer({
      cookie: memberSession.cookie,
      env,
    });

    expect(response.status).toBe(403);
    expect(ensureResponse.status).toBe(403);
  });
});

const stripeBillingDisabledIt = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("organization billing disabled integration", () => {
  stripeBillingDisabledIt(
    "does not expose billing routes when Stripe billing is disabled",
    async ({ env }) => {
      const session = await env.auth.createSession({
        email: "integration-organization-billing-disabled@example.com",
      });

      const response = await getOrganizationBilling({
        cookie: session.cookie,
        env,
      });
      const ensureResponse = await ensureOrganizationBillingCustomer({
        cookie: session.cookie,
        env,
      });

      expect(response.status).toBe(404);
      expect(ensureResponse.status).toBe(404);
    },
  );
});

async function getOrganizationBilling(input: { env: IntegrationTestEnvironment; cookie: string }) {
  return await input.env.controlPlaneApi.http.fetch("/v1/organization/billing", {
    method: "GET",
    headers: {
      cookie: input.cookie,
    },
  });
}

async function ensureOrganizationBillingCustomer(input: {
  env: IntegrationTestEnvironment;
  cookie: string;
}) {
  return await input.env.controlPlaneApi.http.fetch("/v1/organization/billing/customer", {
    method: "POST",
    headers: {
      cookie: input.cookie,
    },
  });
}

async function addMemberToActiveOrganization(input: {
  env: IntegrationTestEnvironment;
  organizationId: string;
  userId: string;
}): Promise<void> {
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.members).values({
    organizationId: input.organizationId,
    userId: input.userId,
    role: "member",
  });

  await input.env.controlPlaneDb
    .update(input.env.controlPlaneTables.sessions)
    .set({
      activeOrganizationId: input.organizationId,
    })
    .where(eq(input.env.controlPlaneTables.sessions.userId, input.userId));
}
