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
import { and, eq, sql } from "drizzle-orm";

import { logger } from "../../logger.js";
import { getWorkflowContext } from "../core/context.js";
import { defineTracedControlPlaneWorkflow } from "../core/tracing.js";
import { createStripeBillingClient } from "./stripe-client.js";

type BillingCustomerTable = ControlPlaneTables["organizationBillingCustomers"];

export const ProvisionStripeCustomerWorkflow = defineTracedControlPlaneWorkflow(
  ProvisionStripeCustomerWorkflowSpec,
  async ({ input, step }) => {
    const { billing, db, tables } = await getWorkflowContext();

    if (!billing.stripe.enabled) {
      throw new Error("Stripe customer provisioning requires billing.stripe.enabled.");
    }

    const billingCustomer = await readStripeBillingCustomer({
      db,
      organizationId: input.organizationId,
    });

    if (billingCustomer === undefined) {
      throw new Error(
        `Stripe billing customer row for organization '${input.organizationId}' was not found.`,
      );
    }

    if (
      billingCustomer.status === OrganizationBillingCustomerStatuses.ACTIVE &&
      billingCustomer.providerCustomerId !== null
    ) {
      return {
        organizationId: input.organizationId,
        stripeCustomerId: billingCustomer.providerCustomerId,
      };
    }

    try {
      const stripe = createStripeBillingClient(billing.stripe.secretKey);
      const stripeCustomer = await step.run({ name: "create-stripe-customer" }, async () =>
        stripe.customers.create(
          {
            name: input.organizationName,
            metadata: {
              mistleOrganizationId: input.organizationId,
            },
          },
          {
            idempotencyKey: createStripeCustomerProvisioningIdempotencyKey(input.organizationId),
          },
        ),
      );

      await db
        .update(tables.organizationBillingCustomers)
        .set({
          providerCustomerId: stripeCustomer.id,
          status: OrganizationBillingCustomerStatuses.ACTIVE,
          lastProvisioningError: null,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(tables.organizationBillingCustomers.organizationId, input.organizationId),
            eq(tables.organizationBillingCustomers.provider, BillingCustomerProviders.STRIPE),
          ),
        );

      logger.info(
        {
          organizationId: input.organizationId,
          stripeCustomerId: stripeCustomer.id,
          workflowName: ProvisionStripeCustomerWorkflowSpec.name,
        },
        "Provisioned Stripe customer for organization",
      );

      return {
        organizationId: input.organizationId,
        stripeCustomerId: stripeCustomer.id,
      };
    } catch (error) {
      await markStripeBillingCustomerProvisioningFailed({
        db,
        organizationBillingCustomers: tables.organizationBillingCustomers,
        organizationId: input.organizationId,
        error,
      });

      logger.error(
        {
          err: error,
          organizationId: input.organizationId,
          workflowName: ProvisionStripeCustomerWorkflowSpec.name,
        },
        "Failed to provision Stripe customer for organization",
      );
      throw error;
    }
  },
);

async function readStripeBillingCustomer(input: {
  db: ControlPlaneDatabase;
  organizationId: string;
}) {
  return input.db.query.organizationBillingCustomers.findFirst({
    where: (table, { and: andOperator, eq: eqOperator }) =>
      andOperator(
        eqOperator(table.organizationId, input.organizationId),
        eqOperator(table.provider, BillingCustomerProviders.STRIPE),
      ),
  });
}

async function markStripeBillingCustomerProvisioningFailed(input: {
  db: ControlPlaneDatabase;
  organizationBillingCustomers: BillingCustomerTable;
  organizationId: string;
  error: unknown;
}): Promise<void> {
  await input.db
    .update(input.organizationBillingCustomers)
    .set({
      status: OrganizationBillingCustomerStatuses.FAILED,
      lastProvisioningError: resolveProvisioningErrorMessage(input.error),
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(input.organizationBillingCustomers.organizationId, input.organizationId),
        eq(input.organizationBillingCustomers.provider, BillingCustomerProviders.STRIPE),
      ),
    );
}

function resolveProvisioningErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return String(error);
}
