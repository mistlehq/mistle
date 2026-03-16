import { index, jsonb, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { dataPlaneSchema } from "./namespace.js";
import { sandboxInstances } from "./sandbox-instances.js";

export type SandboxExecutionLeaseMetadata = Record<string, unknown>;

export const sandboxExecutionLeases = dataPlaneSchema.table(
  "sandbox_execution_leases",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("sxl").toString()),
    sandboxInstanceId: text("sandbox_instance_id")
      .notNull()
      .references(() => sandboxInstances.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    source: text("source").notNull(),
    externalExecutionId: text("external_execution_id"),
    metadata: jsonb("metadata").$type<SandboxExecutionLeaseMetadata>(),
    openedAt: timestamp("opened_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("sandbox_execution_leases_sandbox_instance_id_idx").on(table.sandboxInstanceId),
    index("sandbox_execution_leases_sandbox_instance_last_seen_idx").on(
      table.sandboxInstanceId,
      table.lastSeenAt,
    ),
    uniqueIndex("sandbox_execution_leases_instance_source_execution_uidx").on(
      table.sandboxInstanceId,
      table.source,
      table.externalExecutionId,
    ),
  ],
);

export type SandboxExecutionLease = typeof sandboxExecutionLeases.$inferSelect;
export type InsertSandboxExecutionLease = typeof sandboxExecutionLeases.$inferInsert;
