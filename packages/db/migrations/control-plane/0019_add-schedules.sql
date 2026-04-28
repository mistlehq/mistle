-- squawk-ignore-file ban-drop-column
CREATE TABLE "control_plane"."sandbox_profile_snapshot_refresh_schedule_targets" (
	"schedule_id" text PRIMARY KEY NOT NULL,
	"sandbox_profile_id" text NOT NULL,
	"sandbox_profile_version" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "control_plane"."scheduled_actions" (
	"id" text PRIMARY KEY NOT NULL,
	"schedule_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"target_type" text NOT NULL,
	"target_payload" jsonb NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"local_scheduled_date" text NOT NULL,
	"local_scheduled_time" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatching_at" timestamp with time zone,
	"dispatch_claim_key" text,
	"dispatched_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"skipped_at" timestamp with time zone,
	"skipped_from_scheduled_at" timestamp with time zone,
	"skipped_until_scheduled_at" timestamp with time zone,
	"target_workflow_id" text,
	"target_workflow_started_at" timestamp with time zone,
	"failure_code" text,
	"failure_message" text
);
--> statement-breakpoint
CREATE TABLE "control_plane"."schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"target_type" text NOT NULL,
	"name" text NOT NULL,
	"cron_expression" text NOT NULL,
	"timezone" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"next_scheduled_at" timestamp with time zone,
	"last_scheduled_at" timestamp with time zone,
	"start_at" timestamp with time zone,
	"end_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedules_end_at_after_start_at_check" CHECK ("control_plane"."schedules"."end_at" is null or "control_plane"."schedules"."start_at" is null or "control_plane"."schedules"."end_at" >= "control_plane"."schedules"."start_at")
);
--> statement-breakpoint
TRUNCATE TABLE "control_plane"."schedule_automations";--> statement-breakpoint
DROP INDEX "control_plane"."schedule_automations_automation_id_idx";--> statement-breakpoint
ALTER TABLE "control_plane"."schedule_automations" DROP CONSTRAINT "schedule_automations_pkey";--> statement-breakpoint
ALTER TABLE "control_plane"."automation_runs" ADD COLUMN "source_scheduled_action_id" text;--> statement-breakpoint
ALTER TABLE "control_plane"."sandbox_profile_version_snapshot_jobs" ADD COLUMN "source_scheduled_action_id" text;--> statement-breakpoint
ALTER TABLE "control_plane"."schedule_automations" ADD COLUMN "schedule_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_automations_pkey" ON "control_plane"."schedule_automations" USING btree ("schedule_id");--> statement-breakpoint
ALTER TABLE "control_plane"."schedule_automations" ADD CONSTRAINT "schedule_automations_pkey" PRIMARY KEY USING INDEX "schedule_automations_pkey";--> statement-breakpoint
ALTER TABLE "control_plane"."sandbox_profile_snapshot_refresh_schedule_targets" ADD CONSTRAINT "sandbox_profile_snapshot_refresh_schedule_targets_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "control_plane"."schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."sandbox_profile_snapshot_refresh_schedule_targets" ADD CONSTRAINT "sandbox_profile_snapshot_refresh_schedule_targets_sandbox_profile_id_sandbox_profiles_id_fk" FOREIGN KEY ("sandbox_profile_id") REFERENCES "control_plane"."sandbox_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."sandbox_profile_snapshot_refresh_schedule_targets" ADD CONSTRAINT "sp_snapshot_refresh_targets_profile_version_fkey" FOREIGN KEY ("sandbox_profile_id","sandbox_profile_version") REFERENCES "control_plane"."sandbox_profile_versions"("sandbox_profile_id","version") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."scheduled_actions" ADD CONSTRAINT "scheduled_actions_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "control_plane"."schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."scheduled_actions" ADD CONSTRAINT "scheduled_actions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "control_plane"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."schedules" ADD CONSTRAINT "schedules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "control_plane"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sp_snapshot_refresh_targets_profile_version_idx" ON "control_plane"."sandbox_profile_snapshot_refresh_schedule_targets" USING btree ("sandbox_profile_id","sandbox_profile_version");--> statement-breakpoint
CREATE UNIQUE INDEX "scheduled_actions_schedule_id_scheduled_at_uidx" ON "control_plane"."scheduled_actions" USING btree ("schedule_id","scheduled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "scheduled_actions_schedule_id_local_scheduled_slot_uidx" ON "control_plane"."scheduled_actions" USING btree ("schedule_id","local_scheduled_date","local_scheduled_time");--> statement-breakpoint
CREATE INDEX "scheduled_actions_schedule_id_idx" ON "control_plane"."scheduled_actions" USING btree ("schedule_id");--> statement-breakpoint
CREATE INDEX "scheduled_actions_organization_id_idx" ON "control_plane"."scheduled_actions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "scheduled_actions_status_idx" ON "control_plane"."scheduled_actions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "scheduled_actions_scheduled_at_idx" ON "control_plane"."scheduled_actions" USING btree ("scheduled_at");--> statement-breakpoint
CREATE INDEX "schedules_organization_id_idx" ON "control_plane"."schedules" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "schedules_organization_id_target_type_idx" ON "control_plane"."schedules" USING btree ("organization_id","target_type");--> statement-breakpoint
CREATE INDEX "schedules_due_idx" ON "control_plane"."schedules" USING btree ("next_scheduled_at","id") WHERE "control_plane"."schedules"."enabled" = true and "control_plane"."schedules"."deleted_at" is null and "control_plane"."schedules"."next_scheduled_at" is not null;--> statement-breakpoint
ALTER TABLE "control_plane"."automation_runs" ADD CONSTRAINT "automation_runs_source_scheduled_action_id_scheduled_actions_id_fk" FOREIGN KEY ("source_scheduled_action_id") REFERENCES "control_plane"."scheduled_actions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."sandbox_profile_version_snapshot_jobs" ADD CONSTRAINT "sandbox_profile_version_snapshot_jobs_source_scheduled_action_id_scheduled_actions_id_fk" FOREIGN KEY ("source_scheduled_action_id") REFERENCES "control_plane"."scheduled_actions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."schedule_automations" ADD CONSTRAINT "schedule_automations_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "control_plane"."schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "automation_runs_source_scheduled_action_id_uidx" ON "control_plane"."automation_runs" USING btree ("source_scheduled_action_id") WHERE "control_plane"."automation_runs"."source_scheduled_action_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "spv_snapshot_jobs_source_scheduled_action_id_uidx" ON "control_plane"."sandbox_profile_version_snapshot_jobs" USING btree ("source_scheduled_action_id") WHERE "control_plane"."sandbox_profile_version_snapshot_jobs"."source_scheduled_action_id" is not null;--> statement-breakpoint
ALTER TABLE "control_plane"."schedule_automations" DROP COLUMN "cron_expression";--> statement-breakpoint
ALTER TABLE "control_plane"."schedule_automations" DROP COLUMN "timezone";--> statement-breakpoint
ALTER TABLE "control_plane"."schedule_automations" DROP COLUMN "start_at";--> statement-breakpoint
ALTER TABLE "control_plane"."schedule_automations" DROP COLUMN "end_at";
