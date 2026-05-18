import {
  BillingCustomerProviders,
  OrganizationBillingCustomerStatuses,
  type ControlPlaneDatabase,
  type ControlPlaneTables,
} from "@mistle/db/control-plane";
import {
  createStripeCustomerProvisioningIdempotencyKey,
  ProvisionStripeCustomerWorkflowSpec,
} from "@mistle/workflow-registry/control-plane";
import { sql } from "drizzle-orm";
import type { OpenWorkflow } from "openworkflow";

import type { OrganizationBillingResponse } from "./organization-billing-contract.js";

type ControlPlaneOpenWorkflow = Pick<OpenWorkflow, "runWorkflow">;

type EnqueueStripeCustomerProvisioningInput = {
  db: ControlPlaneDatabase;
  table: ControlPlaneTables["organizationBillingCustomers"];
  openWorkflow: ControlPlaneOpenWorkflow;
  organizationId: string;
  organizationName: string;
};

export async function enqueueStripeCustomerProvisioning(
  input: EnqueueStripeCustomerProvisioningInput,
): Promise<void> {
  await input.db
    .insert(input.table)
    .values({
      organizationId: input.organizationId,
      provider: BillingCustomerProviders.STRIPE,
      status: OrganizationBillingCustomerStatuses.PROVISIONING,
      updatedAt: sql`now()`,
    })
    .onConflictDoNothing({
      target: [input.table.organizationId, input.table.provider],
    });

  await input.openWorkflow.runWorkflow(
    ProvisionStripeCustomerWorkflowSpec,
    {
      organizationId: input.organizationId,
      organizationName: input.organizationName,
    },
    {
      idempotencyKey: createStripeCustomerProvisioningIdempotencyKey(input.organizationId),
    },
  );
}

export async function readOrganizationBilling(input: {
  db: ControlPlaneDatabase;
  organizationId: string;
}): Promise<OrganizationBillingResponse> {
  const billingCustomer = await input.db.query.organizationBillingCustomers.findFirst({
    columns: {
      providerCustomerId: true,
      status: true,
    },
    where: (table, { and, eq }) =>
      and(
        eq(table.organizationId, input.organizationId),
        eq(table.provider, BillingCustomerProviders.STRIPE),
      ),
  });

  if (
    billingCustomer === undefined ||
    billingCustomer.status !== OrganizationBillingCustomerStatuses.ACTIVE ||
    billingCustomer.providerCustomerId === null
  ) {
    return { available: false };
  }

  const organization = await input.db.query.organizations.findFirst({
    columns: {
      name: true,
    },
    where: (table, { eq }) => eq(table.id, input.organizationId),
  });

  if (organization === undefined) {
    throw new Error(
      `Organization ${input.organizationId} was not found for active billing customer.`,
    );
  }

  return {
    available: true,
    organization: {
      name: organization.name,
      stripeCustomerId: billingCustomer.providerCustomerId,
    },
  };
}
