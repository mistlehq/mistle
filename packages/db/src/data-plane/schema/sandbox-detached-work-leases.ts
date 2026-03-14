import { index, text, timestamp } from "drizzle-orm/pg-core";

import { dataPlaneSchema } from "./namespace.js";
import { sandboxInstances } from "./sandbox-instances.js";

export const sandboxDetachedWorkLeases = dataPlaneSchema.table(
  "sandbox_detached_work_leases",
  {
    leaseId: text("lease_id").primaryKey(),
    sandboxInstanceId: text("sandbox_instance_id")
      .notNull()
      .references(() => sandboxInstances.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    protocolFamily: text("protocol_family").notNull(),
    externalExecutionId: text("external_execution_id"),
    openedAt: timestamp("opened_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("sandbox_detached_work_leases_instance_last_seen_idx").on(
      table.sandboxInstanceId,
      table.lastSeenAt,
    ),
  ],
);

export type SandboxDetachedWorkLease = typeof sandboxDetachedWorkLeases.$inferSelect;
export type InsertSandboxDetachedWorkLease = typeof sandboxDetachedWorkLeases.$inferInsert;
