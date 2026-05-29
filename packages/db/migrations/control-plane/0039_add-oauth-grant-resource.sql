ALTER TABLE "control_plane"."oauth_grants" ADD COLUMN "resource" text;--> statement-breakpoint
CREATE INDEX "oauth_grants_resource_idx" ON "control_plane"."oauth_grants" USING btree ("resource");
