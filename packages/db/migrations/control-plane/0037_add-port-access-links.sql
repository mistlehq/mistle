CREATE TABLE "control_plane"."port_access_links" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"organization_id" text NOT NULL,
	"sandbox_instance_id" text NOT NULL,
	"port" bigint NOT NULL,
	"created_by_kind" text NOT NULL,
	"created_by_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "control_plane"."port_access_links" ADD CONSTRAINT "port_access_links_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "control_plane"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "port_access_links_slug_uidx" ON "control_plane"."port_access_links" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "port_access_links_organization_created_at_idx" ON "control_plane"."port_access_links" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "port_access_links_sandbox_instance_created_at_idx" ON "control_plane"."port_access_links" USING btree ("sandbox_instance_id","created_at");--> statement-breakpoint
CREATE INDEX "port_access_links_expires_at_idx" ON "control_plane"."port_access_links" USING btree ("expires_at");