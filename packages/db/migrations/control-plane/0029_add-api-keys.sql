CREATE TABLE "control_plane"."api_key_permissions" (
	"api_key_id" text NOT NULL,
	"permission" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_key_permissions_api_key_id_permission_pk" PRIMARY KEY("api_key_id","permission")
);
--> statement-breakpoint
CREATE TABLE "control_plane"."api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"organization_id" text NOT NULL,
	"secret_prefix" text NOT NULL,
	"secret_hash" text NOT NULL,
	"secret_hash_algorithm" text NOT NULL,
	"created_by_actor_kind" text NOT NULL,
	"created_by_actor_id" text NOT NULL,
	"revoked_by_actor_kind" text,
	"revoked_by_actor_id" text,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "control_plane"."api_key_permissions" ADD CONSTRAINT "api_key_permissions_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "control_plane"."api_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_plane"."api_keys" ADD CONSTRAINT "api_keys_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "control_plane"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_secret_prefix_uidx" ON "control_plane"."api_keys" USING btree ("secret_prefix");--> statement-breakpoint
CREATE INDEX "api_keys_organization_id_revoked_at_idx" ON "control_plane"."api_keys" USING btree ("organization_id","revoked_at");