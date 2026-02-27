CREATE TABLE "data_plane"."sandbox_tunnel_connect_acks" (
	"bootstrap_token_jti" text PRIMARY KEY NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "sandbox_tunnel_connect_acks_connected_at_idx" ON "data_plane"."sandbox_tunnel_connect_acks" USING btree ("connected_at");