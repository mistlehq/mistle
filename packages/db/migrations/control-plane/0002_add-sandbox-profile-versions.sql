CREATE TABLE "control_plane"."sandbox_profile_versions" (
	"sandbox_profile_id" text NOT NULL,
	"version" bigint NOT NULL,
	"manifest" jsonb NOT NULL,
	CONSTRAINT "sandbox_profile_versions_sandbox_profile_id_version_pk" PRIMARY KEY("sandbox_profile_id","version")
);
--> statement-breakpoint
ALTER TABLE "control_plane"."sandbox_profile_versions" ADD CONSTRAINT "sandbox_profile_versions_sandbox_profile_id_sandbox_profiles_id_fk" FOREIGN KEY ("sandbox_profile_id") REFERENCES "control_plane"."sandbox_profiles"("id") ON DELETE cascade ON UPDATE no action;