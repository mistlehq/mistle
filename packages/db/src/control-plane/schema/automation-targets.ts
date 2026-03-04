import { bigint, index, text, timestamp } from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { automations } from "./automations.js";
import { controlPlaneSchema } from "./namespace.js";
import { sandboxProfiles } from "./sandbox-profiles.js";

export const automationTargets = controlPlaneSchema.table(
  "automation_targets",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("atg").toString()),
    automationId: text("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    sandboxProfileId: text("sandbox_profile_id")
      .notNull()
      .references(() => sandboxProfiles.id, { onDelete: "cascade" }),
    sandboxProfileVersion: bigint("sandbox_profile_version", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("automation_targets_sandbox_profile_id_idx").on(table.sandboxProfileId),
    index("automation_targets_automation_id_idx").on(table.automationId),
  ],
);

export type AutomationTarget = typeof automationTargets.$inferSelect;
export type InsertAutomationTarget = typeof automationTargets.$inferInsert;
