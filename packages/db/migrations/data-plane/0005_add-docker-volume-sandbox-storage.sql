-- squawk-ignore-file ban-drop-not-null
ALTER TABLE "data_plane"."sandbox_instance_storages" ALTER COLUMN "region" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "data_plane"."sandbox_instance_storages" ALTER COLUMN "credential_ciphertext" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "data_plane"."sandbox_instance_storages" ALTER COLUMN "credential_nonce" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "data_plane"."sandbox_instance_storages" ALTER COLUMN "credential_kind" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "data_plane"."sandbox_instance_storages" ALTER COLUMN "credential_kind" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "data_plane"."sandbox_instance_storages" ALTER COLUMN "organization_credential_key_version" DROP NOT NULL;
