-- squawk-ignore-file renaming-column
ALTER TABLE "control_plane"."sandbox_profile_versions" RENAME COLUMN "sandbox_storage_mb" TO "sandbox_disk_mb";
