-- squawk-ignore-file adding-not-nullable-field
-- squawk-ignore-file ban-drop-column
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "control_plane"."webhook_triggers"
    WHERE
      "event_types" IS NULL OR
      jsonb_typeof("event_types") <> 'array' OR
      jsonb_array_length("event_types") = 0
  ) THEN
    RAISE EXCEPTION 'Cannot migrate webhook triggers with null, non-array, or empty event_types. Convert all legacy webhook triggers to explicit trigger event conditions before applying this migration.';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "control_plane"."webhook_triggers" ADD COLUMN "event_conditions" jsonb;--> statement-breakpoint
UPDATE "control_plane"."webhook_triggers"
SET "event_conditions" = (
  SELECT jsonb_agg(
    CASE
      WHEN "webhook_triggers"."payload_filter" ? "selected_events"."event_type" THEN
        jsonb_build_object(
          'eventType',
          "selected_events"."event_type",
          'payloadFilter',
          "webhook_triggers"."payload_filter"->"selected_events"."event_type"
        )
      ELSE
        jsonb_build_object('eventType', "selected_events"."event_type")
    END
    ORDER BY "ordinality"
  )
  FROM jsonb_array_elements_text("webhook_triggers"."event_types") WITH ORDINALITY AS "selected_events"("event_type", "ordinality")
);--> statement-breakpoint
ALTER TABLE "control_plane"."webhook_triggers" ALTER COLUMN "event_conditions" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "control_plane"."webhook_triggers" DROP COLUMN "event_types";--> statement-breakpoint
ALTER TABLE "control_plane"."webhook_triggers" DROP COLUMN "payload_filter";--> statement-breakpoint
ALTER TABLE "control_plane"."webhook_triggers" ADD CONSTRAINT "webhook_triggers_event_conditions_non_empty_check" CHECK (jsonb_typeof("control_plane"."webhook_triggers"."event_conditions") = 'array' and jsonb_array_length("control_plane"."webhook_triggers"."event_conditions") > 0);
