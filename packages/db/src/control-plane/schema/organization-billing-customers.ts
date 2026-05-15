import { text, timestamp, uniqueIndex, type PgSchema } from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { controlPlaneSchema } from "./namespace.js";
import { organizations } from "./organizations.js";

export const BillingCustomerProviders = {
  STRIPE: "stripe",
} as const;

export type BillingCustomerProvider =
  (typeof BillingCustomerProviders)[keyof typeof BillingCustomerProviders];

export const OrganizationBillingCustomerStatuses = {
  PROVISIONING: "provisioning",
  ACTIVE: "active",
  FAILED: "failed",
} as const;

export type OrganizationBillingCustomerStatus =
  (typeof OrganizationBillingCustomerStatuses)[keyof typeof OrganizationBillingCustomerStatuses];

export function defineOrganizationBillingCustomers(schema: PgSchema) {
  return schema.table(
    "organization_billing_customers",
    {
      id: text("id")
        .primaryKey()
        .$defaultFn(() => typeid("obc").toString()),
      organizationId: text("organization_id")
        .notNull()
        .references(() => organizations.id, { onDelete: "cascade" }),
      provider: text("provider").notNull().$type<BillingCustomerProvider>(),
      status: text("status")
        .notNull()
        .$type<OrganizationBillingCustomerStatus>()
        .default(OrganizationBillingCustomerStatuses.PROVISIONING),
      providerCustomerId: text("provider_customer_id"),
      lastProvisioningError: text("last_provisioning_error"),
      createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
        .notNull()
        .defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
        .notNull()
        .defaultNow(),
    },
    (table) => [
      uniqueIndex("organization_billing_customers_org_provider_uidx").on(
        table.organizationId,
        table.provider,
      ),
      uniqueIndex("organization_billing_customers_provider_customer_uidx").on(
        table.provider,
        table.providerCustomerId,
      ),
    ],
  );
}

export const organizationBillingCustomers = defineOrganizationBillingCustomers(controlPlaneSchema);

export type OrganizationBillingCustomer = typeof organizationBillingCustomers.$inferSelect;
export type InsertOrganizationBillingCustomer = typeof organizationBillingCustomers.$inferInsert;
