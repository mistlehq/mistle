CREATE SCHEMA "data_plane";
--> statement-breakpoint
CREATE TABLE "data_plane"."sandbox_instances" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"sandbox_profile_id" text NOT NULL,
	"sandbox_profile_version" bigint NOT NULL,
	"runtime_provider" text NOT NULL,
	"provider_runtime_id" text,
	"instance_volume_provider" text,
	"instance_volume_id" text,
	"instance_volume_mode" text,
	"status" text DEFAULT 'starting' NOT NULL,
	"started_by_kind" text NOT NULL,
	"started_by_id" text NOT NULL,
	"source" text NOT NULL,
	"started_at" timestamp with time zone,
	"stopped_at" timestamp with time zone,
	"stop_reason" text,
	"failed_at" timestamp with time zone,
	"failure_code" text,
	"failure_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX "sandbox_instances_organization_id_idx" ON "data_plane"."sandbox_instances" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "sandbox_instances_org_profile_version_idx" ON "data_plane"."sandbox_instances" USING btree ("organization_id","sandbox_profile_id","sandbox_profile_version");--> statement-breakpoint
CREATE INDEX "sandbox_instances_org_status_updated_idx" ON "data_plane"."sandbox_instances" USING btree ("organization_id","status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sandbox_instances_provider_runtime_uidx" ON "data_plane"."sandbox_instances" USING btree ("runtime_provider","provider_runtime_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sandbox_instances_instance_volume_uidx" ON "data_plane"."sandbox_instances" USING btree ("instance_volume_provider","instance_volume_id");
