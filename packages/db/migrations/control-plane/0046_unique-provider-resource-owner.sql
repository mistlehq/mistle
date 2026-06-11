WITH ranked_provider_resource_associations AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "integration_connection_id", "resource_kind", "provider_resource_id"
      ORDER BY "created_at", "id"
    ) AS "owner_rank"
  FROM "control_plane"."provider_resource_associations"
)
DELETE FROM "control_plane"."provider_resource_associations"
USING "ranked_provider_resource_associations"
WHERE
  "provider_resource_associations"."id" = "ranked_provider_resource_associations"."id"
  AND "ranked_provider_resource_associations"."owner_rank" > 1;--> statement-breakpoint
DROP INDEX "control_plane"."provider_resource_associations_resource_instance_uidx";--> statement-breakpoint
DROP INDEX "control_plane"."provider_resource_associations_resource_lookup_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "provider_resource_associations_resource_uidx" ON "control_plane"."provider_resource_associations" USING btree ("integration_connection_id","resource_kind","provider_resource_id");
