/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import {
  BillingCustomerProviders,
  OrganizationBillingCustomerStatuses,
} from "@mistle/db/control-plane";
import { createControlPlaneWorkflowNamespaceId } from "@mistle/db/test-environment";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import type { IntegrationTestEnvironment } from "@mistle/test-harness/integration";
import {
  createStripeCustomerProvisioningIdempotencyKey,
  ProvisionStripeCustomerWorkflowSpec,
} from "@mistle/workflow-registry/control-plane";
import { sql } from "drizzle-orm";
import { describe, expect } from "vitest";

import { enqueueStripeCustomerProvisioning } from "../src/auth/services/enqueue-stripe-customer-provisioning.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("auth Stripe customer provisioning integration", () => {
  it("keeps billing customer enqueue safe when the same organization is initialized more than once", async ({
    env,
  }) => {
    const organizationName = "Stripe Idempotency Integration";
    const session = await env.auth.createSession({
      email: "integration-new-stripe-idempotency@example.com",
      organizationName,
    });

    await enqueueStripeCustomerProvisioning({
      db: env.controlPlaneDb,
      table: env.controlPlaneTables.organizationBillingCustomers,
      openWorkflow: env.controlPlaneWorkflow,
      stripeEnabled: true,
      organizationId: session.organizationId,
      organizationName,
    });
    await enqueueStripeCustomerProvisioning({
      db: env.controlPlaneDb,
      table: env.controlPlaneTables.organizationBillingCustomers,
      openWorkflow: env.controlPlaneWorkflow,
      stripeEnabled: true,
      organizationId: session.organizationId,
      organizationName,
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
      countQueuedStripeProvisioningWorkflows({
        env,
        organizationId: session.organizationId,
      }),
    ).resolves.toBe(1);
  });
});

async function countQueuedStripeProvisioningWorkflows(input: {
  env: IntegrationTestEnvironment;
  organizationId: string;
}): Promise<number> {
  const result = await input.env.controlPlaneDb.execute(sql<{ count: string }>`
    select count(*)::text as count
    from control_plane_openworkflow.workflow_runs
    where
      namespace_id = ${createControlPlaneWorkflowNamespaceId(input.env.id)}
      and workflow_name = ${ProvisionStripeCustomerWorkflowSpec.name}
      and idempotency_key = ${createStripeCustomerProvisioningIdempotencyKey(input.organizationId)}
  `);

  return Number(result.rows[0]?.count ?? "0");
}
