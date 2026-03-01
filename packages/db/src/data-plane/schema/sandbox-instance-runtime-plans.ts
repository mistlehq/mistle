import { sql } from "drizzle-orm";
import { bigint, index, jsonb, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { dataPlaneSchema } from "./namespace.js";
import { sandboxInstances } from "./sandbox-instances.js";

export const sandboxInstanceRuntimePlans = dataPlaneSchema.table(
  "sandbox_instance_runtime_plans",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("srp").toString()),
    sandboxInstanceId: text("sandbox_instance_id")
      .notNull()
      .references(() => sandboxInstances.id, { onDelete: "cascade" }),
    revision: bigint("revision", { mode: "number" }).notNull(),
    compiledRuntimePlan: jsonb("compiled_runtime_plan").$type<Record<string, unknown>>().notNull(),
    compiledFromProfileId: text("compiled_from_profile_id").notNull(),
    compiledFromProfileVersion: bigint("compiled_from_profile_version", {
      mode: "number",
    }).notNull(),
    supersededAt: timestamp("superseded_at", { withTimezone: true, mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("sandbox_instance_runtime_plans_instance_revision_uidx").on(
      table.sandboxInstanceId,
      table.revision,
    ),
    uniqueIndex("sandbox_instance_runtime_plans_active_plan_uidx")
      .on(table.sandboxInstanceId)
      .where(sql`${table.supersededAt} is null`),
    index("sandbox_instance_runtime_plans_instance_created_idx").on(
      table.sandboxInstanceId,
      table.createdAt,
    ),
  ],
);

export type SandboxInstanceRuntimePlan = typeof sandboxInstanceRuntimePlans.$inferSelect;
export type InsertSandboxInstanceRuntimePlan = typeof sandboxInstanceRuntimePlans.$inferInsert;
