CREATE TABLE "control_plane"."avatar_upload_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_user_id" text NOT NULL,
	"subject_kind" text NOT NULL,
	"subject_id" text NOT NULL,
	"temporary_object_key" text NOT NULL,
	"source_content_type" text NOT NULL,
	"source_file_size" bigint NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"finalized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "control_plane"."organizations" ADD COLUMN "logo_key" text;--> statement-breakpoint
ALTER TABLE "control_plane"."users" ADD COLUMN "avatar_key" text;--> statement-breakpoint
