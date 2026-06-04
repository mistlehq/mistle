-- squawk-ignore-file ban-drop-column
-- squawk-ignore-file renaming-column
ALTER TABLE "data_plane"."sandbox_instances" RENAME COLUMN "sandbox_storage_mb" TO "sandbox_disk_mb";--> statement-breakpoint
ALTER TABLE "data_plane"."sandbox_usage_events" RENAME COLUMN "storage_mb" TO "disk_mb";--> statement-breakpoint
ALTER TABLE "data_plane"."sandbox_usage_events" DROP COLUMN "storage_provider";--> statement-breakpoint
ALTER TABLE "data_plane"."sandbox_usage_events" DROP COLUMN "provider_storage_id";
