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

type ControlPlaneOpenWorkflow = Pick<OpenWorkflow, "runWorkflow">;

type EnqueueStripeCustomerProvisioningInput = {
  db: ControlPlaneDatabase;
  table: ControlPlaneTables["organizationBillingCustomers"];
  openWorkflow: ControlPlaneOpenWorkflow;
  stripeEnabled: boolean;
  organizationId: string;
  organizationName: string;
};

export async function enqueueStripeCustomerProvisioning(
  input: EnqueueStripeCustomerProvisioningInput,
): Promise<void> {
  if (!input.stripeEnabled) {
    return;
  }

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
