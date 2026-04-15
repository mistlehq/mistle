CREATE TABLE "data_plane"."sandbox_instance_storages" (
	"id" text PRIMARY KEY NOT NULL,
	"sandbox_instance_id" text NOT NULL,
	"provider" text NOT NULL,
	"handle" text NOT NULL,
	"region" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"credential_ciphertext" text NOT NULL,
	"credential_nonce" text NOT NULL,
	"credential_kind" text DEFAULT 'disk_token' NOT NULL,
	"organization_credential_key_version" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "data_plane"."sandbox_instances" ADD COLUMN "persistence_mode" text DEFAULT 'ephemeral' NOT NULL;--> statement-breakpoint
ALTER TABLE "data_plane"."sandbox_instance_storages" ADD CONSTRAINT "sandbox_instance_storages_sandbox_instance_id_sandbox_instances_id_fk" FOREIGN KEY ("sandbox_instance_id") REFERENCES "data_plane"."sandbox_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sandbox_instance_storages_sandbox_instance_id_uidx" ON "data_plane"."sandbox_instance_storages" USING btree ("sandbox_instance_id");