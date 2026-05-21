-- squawk-ignore-file ban-drop-not-null
ALTER TABLE "control_plane"."schedules" ALTER COLUMN "cron_expression" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "control_plane"."schedules" ALTER COLUMN "timezone" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "control_plane"."schedules" ADD COLUMN "kind" text DEFAULT 'recurring' NOT NULL;--> statement-breakpoint
ALTER TABLE "control_plane"."schedules" ADD COLUMN "one_off_workflow_run_id" text;
