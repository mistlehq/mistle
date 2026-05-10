ALTER TABLE "data_plane"."sandbox_instances" ADD COLUMN "sandbox_connection_id" text;--> statement-breakpoint
ALTER TABLE "data_plane"."sandbox_instances" ADD COLUMN "sandbox_vcpu_count" bigint;--> statement-breakpoint
ALTER TABLE "data_plane"."sandbox_instances" ADD COLUMN "sandbox_memory_mb" bigint;--> statement-breakpoint
ALTER TABLE "data_plane"."sandbox_instances" ADD COLUMN "sandbox_storage_mb" bigint;
