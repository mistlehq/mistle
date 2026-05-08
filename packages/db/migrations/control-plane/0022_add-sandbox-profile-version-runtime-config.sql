ALTER TABLE "control_plane"."sandbox_profile_versions" ADD COLUMN "sandbox_provider" text;--> statement-breakpoint
ALTER TABLE "control_plane"."sandbox_profile_versions" ADD COLUMN "sandbox_connection_id" text;--> statement-breakpoint
ALTER TABLE "control_plane"."sandbox_profile_versions" ADD COLUMN "sandbox_vcpu_count" bigint;--> statement-breakpoint
ALTER TABLE "control_plane"."sandbox_profile_versions" ADD COLUMN "sandbox_memory_mb" bigint;--> statement-breakpoint
ALTER TABLE "control_plane"."sandbox_profile_versions" ADD COLUMN "sandbox_storage_mb" bigint;--> statement-breakpoint
ALTER TABLE "control_plane"."sandbox_profile_versions" ADD CONSTRAINT "sandbox_profile_versions_sandbox_connection_id_fkey" FOREIGN KEY ("sandbox_connection_id") REFERENCES "control_plane"."integration_connections"("id") ON DELETE restrict ON UPDATE no action;