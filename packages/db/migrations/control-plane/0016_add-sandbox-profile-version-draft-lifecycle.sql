ALTER TABLE "control_plane"."sandbox_profile_versions" ADD COLUMN "state" text DEFAULT 'published' NOT NULL;--> statement-breakpoint
ALTER TABLE "control_plane"."sandbox_profile_versions" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "control_plane"."sandbox_profiles" ADD COLUMN "active_version" bigint;
--> statement-breakpoint
UPDATE "control_plane"."sandbox_profile_versions"
SET "published_at" = now()
WHERE "published_at" IS NULL;
--> statement-breakpoint
UPDATE "control_plane"."sandbox_profiles" AS sp
SET "active_version" = latest_versions."latest_version"
FROM (
  SELECT
    spv."sandbox_profile_id",
    max(spv."version")::bigint AS "latest_version"
  FROM "control_plane"."sandbox_profile_versions" AS spv
  GROUP BY spv."sandbox_profile_id"
) AS latest_versions
WHERE latest_versions."sandbox_profile_id" = sp."id";
