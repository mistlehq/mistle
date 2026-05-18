import { bigint, index, text, timestamp, type PgSchema } from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { controlPlaneSchema } from "./namespace.js";
import { sandboxProfiles } from "./sandbox-profiles.js";
import { triggers } from "./triggers.js";

export function defineTriggerTargets(schema: PgSchema) {
  return schema.table(
    "trigger_targets",
    {
      id: text("id")
        .primaryKey()
        .$defaultFn(() => typeid("tgt").toString()),
      triggerId: text("trigger_id")
        .notNull()
        .references(() => triggers.id, { onDelete: "cascade" }),
      sandboxProfileId: text("sandbox_profile_id")
        .notNull()
        .references(() => sandboxProfiles.id, { onDelete: "cascade" }),
      sandboxProfileVersion: bigint("sandbox_profile_version", { mode: "number" }).notNull(),
      primaryRepositoryId: text("primary_repository_id"),
      createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
        .notNull()
        .defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
        .notNull()
        .defaultNow(),
    },
    (table) => [
      index("trigger_targets_sandbox_profile_id_idx").on(table.sandboxProfileId),
      index("trigger_targets_trigger_id_idx").on(table.triggerId),
    ],
  );
}

export const triggerTargets = defineTriggerTargets(controlPlaneSchema);

export type TriggerTarget = typeof triggerTargets.$inferSelect;
export type InsertTriggerTarget = typeof triggerTargets.$inferInsert;
