ALTER TABLE "control_plane"."automation_runs" ADD COLUMN "instructions" text;--> statement-breakpoint
ALTER TABLE "control_plane"."webhook_automations" ADD COLUMN "instructions" text;