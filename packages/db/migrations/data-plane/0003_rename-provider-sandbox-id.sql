ALTER TABLE "data_plane"."sandbox_instances" RENAME COLUMN "provider_runtime_id" TO "provider_sandbox_id";--> statement-breakpoint
DROP INDEX "data_plane"."sandbox_instances_provider_runtime_uidx";--> statement-breakpoint
CREATE UNIQUE INDEX "sandbox_instances_provider_sandbox_uidx" ON "data_plane"."sandbox_instances" USING btree ("runtime_provider","provider_sandbox_id");