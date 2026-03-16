CREATE SCHEMA "data_plane";
--> statement-breakpoint
CREATE TABLE "data_plane"."sandbox_execution_leases" (
	"id" text PRIMARY KEY NOT NULL,
	"sandbox_instance_id" text NOT NULL,
	"kind" text NOT NULL,
	"source" text NOT NULL,
	"external_execution_id" text,
	"metadata" jsonb,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_plane"."sandbox_instances" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"sandbox_profile_id" text NOT NULL,
	"sandbox_profile_version" bigint NOT NULL,
	"provider" text NOT NULL,
	"provider_sandbox_id" text,
	"status" text DEFAULT 'starting' NOT NULL,
	"started_by_kind" text NOT NULL,
	"started_by_id" text NOT NULL,
	"source" text NOT NULL,
	"started_at" timestamp with time zone,
	"tunnel_connected_at" timestamp with time zone,
	"last_tunnel_seen_at" timestamp with time zone,
	"active_tunnel_lease_id" text,
	"tunnel_disconnected_at" timestamp with time zone,
	"stopped_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"failure_code" text,
	"failure_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "data_plane"."sandbox_execution_leases" ADD CONSTRAINT "sandbox_execution_leases_sandbox_instance_id_sandbox_instances_id_fk" FOREIGN KEY ("sandbox_instance_id") REFERENCES "data_plane"."sandbox_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sandbox_execution_leases_sandbox_instance_id_idx" ON "data_plane"."sandbox_execution_leases" USING btree ("sandbox_instance_id");--> statement-breakpoint
CREATE INDEX "sandbox_execution_leases_sandbox_instance_last_seen_idx" ON "data_plane"."sandbox_execution_leases" USING btree ("sandbox_instance_id","last_seen_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sandbox_execution_leases_instance_source_execution_uidx" ON "data_plane"."sandbox_execution_leases" USING btree ("sandbox_instance_id","source","external_execution_id");--> statement-breakpoint
CREATE INDEX "sandbox_instances_organization_id_idx" ON "data_plane"."sandbox_instances" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "sandbox_instances_org_profile_version_idx" ON "data_plane"."sandbox_instances" USING btree ("organization_id","sandbox_profile_id","sandbox_profile_version");--> statement-breakpoint
CREATE INDEX "sandbox_instances_org_status_updated_idx" ON "data_plane"."sandbox_instances" USING btree ("organization_id","status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sandbox_instances_provider_sandbox_uidx" ON "data_plane"."sandbox_instances" USING btree ("provider","provider_sandbox_id");
