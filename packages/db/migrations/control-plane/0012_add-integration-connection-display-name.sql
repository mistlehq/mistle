ALTER TABLE "control_plane"."integration_connections" ADD COLUMN "display_name" text;--> statement-breakpoint
UPDATE "control_plane"."integration_connections" SET "display_name" = "id" WHERE "display_name" IS NULL;--> statement-breakpoint
ALTER TABLE "control_plane"."integration_connections" ALTER COLUMN "display_name" SET NOT NULL;--> statement-breakpoint
