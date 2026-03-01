CREATE TABLE "data_plane"."sandbox_instance_runtime_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"sandbox_instance_id" text NOT NULL,
	"revision" bigint NOT NULL,
	"compiled_runtime_plan" jsonb NOT NULL,
	"compiled_from_profile_id" text NOT NULL,
	"compiled_from_profile_version" bigint NOT NULL,
	"superseded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "data_plane"."sandbox_instance_runtime_plans" ADD CONSTRAINT "sandbox_instance_runtime_plans_sandbox_instance_id_sandbox_instances_id_fk" FOREIGN KEY ("sandbox_instance_id") REFERENCES "data_plane"."sandbox_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sandbox_instance_runtime_plans_instance_revision_uidx" ON "data_plane"."sandbox_instance_runtime_plans" USING btree ("sandbox_instance_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "sandbox_instance_runtime_plans_active_plan_uidx" ON "data_plane"."sandbox_instance_runtime_plans" USING btree ("sandbox_instance_id") WHERE "data_plane"."sandbox_instance_runtime_plans"."superseded_at" is null;--> statement-breakpoint
CREATE INDEX "sandbox_instance_runtime_plans_instance_created_idx" ON "data_plane"."sandbox_instance_runtime_plans" USING btree ("sandbox_instance_id","created_at");