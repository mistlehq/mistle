CREATE TABLE "control_plane"."sandbox_profile_setup_checks" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"sandbox_profile_id" text NOT NULL,
	"sandbox_profile_version" bigint NOT NULL,
	"requested_by_user_id" text,
	"setup_script" text,
	"primary_repository_id" text,
	"idempotency_key" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"failure_phase" text,
	"failure_code" text,
	"failure_message" text,
	"sandbox_instance_id" text,
	"workflow_run_id" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "control_plane"."sandbox_profile_setup_checks" ADD CONSTRAINT "sandbox_profile_setup_checks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "control_plane"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."sandbox_profile_setup_checks" ADD CONSTRAINT "sandbox_profile_setup_checks_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "control_plane"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."sandbox_profile_setup_checks" ADD CONSTRAINT "sandbox_profile_setup_checks_profile_version_fkey" FOREIGN KEY ("sandbox_profile_id","sandbox_profile_version") REFERENCES "control_plane"."sandbox_profile_versions"("sandbox_profile_id","version") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sandbox_profile_setup_checks_idempotency_uidx" ON "control_plane"."sandbox_profile_setup_checks" USING btree ("organization_id","sandbox_profile_id","sandbox_profile_version","idempotency_key") WHERE "control_plane"."sandbox_profile_setup_checks"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "sandbox_profile_setup_checks_profile_version_created_idx" ON "control_plane"."sandbox_profile_setup_checks" USING btree ("sandbox_profile_id","sandbox_profile_version","created_at");--> statement-breakpoint
CREATE INDEX "sandbox_profile_setup_checks_status_created_idx" ON "control_plane"."sandbox_profile_setup_checks" USING btree ("status","created_at");