CREATE TABLE "control_plane"."organization_billing_customers" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"provider" text NOT NULL,
	"status" text DEFAULT 'provisioning' NOT NULL,
	"provider_customer_id" text,
	"last_provisioning_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "control_plane"."organization_billing_customers" ADD CONSTRAINT "organization_billing_customers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "control_plane"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "organization_billing_customers_org_provider_uidx" ON "control_plane"."organization_billing_customers" USING btree ("organization_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_billing_customers_provider_customer_uidx" ON "control_plane"."organization_billing_customers" USING btree ("provider","provider_customer_id");
