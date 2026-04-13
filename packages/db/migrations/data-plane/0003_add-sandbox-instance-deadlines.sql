CREATE TABLE "data_plane"."sandbox_instance_deadlines" (
	"sandbox_instance_id" text NOT NULL,
	"kind" text NOT NULL,
	"owner_lease_id" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"generation" bigint DEFAULT 1 NOT NULL,
	"cleared_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sandbox_instance_deadlines_pk" PRIMARY KEY("sandbox_instance_id","kind"),
	CONSTRAINT "sandbox_instance_deadlines_kind_check" CHECK ("data_plane"."sandbox_instance_deadlines"."kind" in ('idle', 'disconnect'))
);
--> statement-breakpoint
ALTER TABLE "data_plane"."sandbox_instance_deadlines" ADD CONSTRAINT "sandbox_instance_deadlines_sandbox_instance_id_sandbox_instances_id_fk" FOREIGN KEY ("sandbox_instance_id") REFERENCES "data_plane"."sandbox_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sandbox_instance_deadlines_due_at_idx" ON "data_plane"."sandbox_instance_deadlines" USING btree ("due_at");