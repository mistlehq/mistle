import { sql } from "drizzle-orm";
import {
  bigint,
  index,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  type PgSchema,
} from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { dataPlaneSchema } from "./namespace.js";
import { defineSandboxInstances, sandboxInstances } from "./sandbox-instances.js";

export function defineSandboxInstanceRuntimePlans(input: {
  schema: PgSchema;
  sandboxInstances: ReturnType<typeof defineSandboxInstances>;
}) {
  return input.schema.table(
    "sandbox_instance_runtime_plans",
    {
      id: text("id")
        .primaryKey()
        .$defaultFn(() => typeid("srp").toString()),
      sandboxInstanceId: text("sandbox_instance_id")
        .notNull()
        .references(() => input.sandboxInstances.id, { onDelete: "cascade" }),
      revision: bigint("revision", { mode: "number" }).notNull(),
      compiledRuntimePlan: jsonb("compiled_runtime_plan")
        .$type<Record<string, unknown>>()
        .notNull(),
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
}

export const sandboxInstanceRuntimePlans = defineSandboxInstanceRuntimePlans({
  schema: dataPlaneSchema,
  sandboxInstances,
});

export type SandboxInstanceRuntimePlan = typeof sandboxInstanceRuntimePlans.$inferSelect;
export type InsertSandboxInstanceRuntimePlan = typeof sandboxInstanceRuntimePlans.$inferInsert;
