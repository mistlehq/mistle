CREATE TABLE "control_plane"."sandbox_profile_version_snapshot_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"sandbox_profile_id" text NOT NULL,
	"sandbox_profile_version" bigint NOT NULL,
	"workflow_run_id" text,
	"trigger" text NOT NULL,
	"state" text NOT NULL,
	"candidate_image_provider" text,
	"candidate_image_id" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error_code" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spv_snapshot_jobs_candidate_image_handle_check" CHECK (("control_plane"."sandbox_profile_version_snapshot_jobs"."candidate_image_provider" is null and "control_plane"."sandbox_profile_version_snapshot_jobs"."candidate_image_id" is null) or ("control_plane"."sandbox_profile_version_snapshot_jobs"."candidate_image_provider" is not null and "control_plane"."sandbox_profile_version_snapshot_jobs"."candidate_image_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "control_plane"."sandbox_profile_versions" ADD COLUMN "snapshot_image_provider" text;--> statement-breakpoint
ALTER TABLE "control_plane"."sandbox_profile_versions" ADD COLUMN "snapshot_image_id" text;--> statement-breakpoint
ALTER TABLE "control_plane"."sandbox_profile_version_snapshot_jobs" ADD CONSTRAINT "spv_snapshot_jobs_profile_version_fkey" FOREIGN KEY ("sandbox_profile_id","sandbox_profile_version") REFERENCES "control_plane"."sandbox_profile_versions"("sandbox_profile_id","version") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "spv_snapshot_jobs_active_job_per_version_uidx" ON "control_plane"."sandbox_profile_version_snapshot_jobs" USING btree ("sandbox_profile_id","sandbox_profile_version") WHERE "control_plane"."sandbox_profile_version_snapshot_jobs"."state" in ('queued', 'running');--> statement-breakpoint
CREATE INDEX "spv_snapshot_jobs_profile_version_created_idx" ON "control_plane"."sandbox_profile_version_snapshot_jobs" USING btree ("sandbox_profile_id","sandbox_profile_version","created_at");--> statement-breakpoint
CREATE INDEX "spv_snapshot_jobs_state_created_idx" ON "control_plane"."sandbox_profile_version_snapshot_jobs" USING btree ("state","created_at");--> statement-breakpoint
ALTER TABLE "control_plane"."sandbox_profile_versions" ADD CONSTRAINT "sandbox_profile_versions_snapshot_image_handle_check" CHECK (("control_plane"."sandbox_profile_versions"."snapshot_image_provider" is null and "control_plane"."sandbox_profile_versions"."snapshot_image_id" is null) or ("control_plane"."sandbox_profile_versions"."snapshot_image_provider" is not null and "control_plane"."sandbox_profile_versions"."snapshot_image_id" is not null));