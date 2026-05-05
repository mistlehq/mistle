ALTER TABLE "control_plane"."sandbox_profile_versions" ADD COLUMN "default_persistence_mode" text DEFAULT 'ephemeral' NOT NULL;
