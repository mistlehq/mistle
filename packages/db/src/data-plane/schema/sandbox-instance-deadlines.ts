import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  primaryKey,
  text,
  timestamp,
  type PgSchema,
} from "drizzle-orm/pg-core";

import { dataPlaneSchema } from "./namespace.js";
import { defineSandboxInstances, sandboxInstances } from "./sandbox-instances.js";

export const SandboxInstanceDeadlineKinds = {
  IDLE: "idle",
  DISCONNECT: "disconnect",
} as const;

export type SandboxInstanceDeadlineKind =
  (typeof SandboxInstanceDeadlineKinds)[keyof typeof SandboxInstanceDeadlineKinds];

export function defineSandboxInstanceDeadlines(input: {
  schema: PgSchema;
  sandboxInstances: ReturnType<typeof defineSandboxInstances>;
}) {
  return input.schema.table(
    "sandbox_instance_deadlines",
    {
      sandboxInstanceId: text("sandbox_instance_id")
        .notNull()
        .references(() => input.sandboxInstances.id, { onDelete: "cascade" }),
      kind: text("kind").notNull().$type<SandboxInstanceDeadlineKind>(),
      ownerLeaseId: text("owner_lease_id").notNull(),
      dueAt: timestamp("due_at", { withTimezone: true, mode: "string" }).notNull(),
      generation: bigint("generation", { mode: "number" }).notNull().default(1),
      clearedAt: timestamp("cleared_at", { withTimezone: true, mode: "string" }),
      createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
        .notNull()
        .defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
        .notNull()
        .defaultNow(),
    },
    (table) => [
      primaryKey({
        name: "sandbox_instance_deadlines_pk",
        columns: [table.sandboxInstanceId, table.kind],
      }),
      check("sandbox_instance_deadlines_kind_check", sql`${table.kind} in ('idle', 'disconnect')`),
      index("sandbox_instance_deadlines_due_at_idx").on(table.dueAt),
    ],
  );
}

export const sandboxInstanceDeadlines = defineSandboxInstanceDeadlines({
  schema: dataPlaneSchema,
  sandboxInstances,
});
