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
import type { SandboxStorageProvider } from "./sandbox-instance-storages.js";
import {
  defineSandboxInstances,
  sandboxInstances,
  type SandboxInstanceProvider,
} from "./sandbox-instances.js";

export const SandboxUsageEventTypes = {
  SANDBOX_ALLOCATED: "sandbox_allocated",
  SANDBOX_READY: "sandbox_ready",
  SANDBOX_STOPPED: "sandbox_stopped",
  SANDBOX_FAILED: "sandbox_failed",
  SANDBOX_REPLACED: "sandbox_replaced",
  STORAGE_PROVISIONED: "storage_provisioned",
  STORAGE_DEPROVISIONED: "storage_deprovisioned",
} as const;

export type SandboxUsageEventType =
  (typeof SandboxUsageEventTypes)[keyof typeof SandboxUsageEventTypes];

export function defineSandboxUsageEvents(input: {
  schema: PgSchema;
  sandboxInstances: ReturnType<typeof defineSandboxInstances>;
}) {
  return input.schema.table(
    "sandbox_usage_events",
    {
      id: text("id")
        .primaryKey()
        .$defaultFn(() => typeid("sue").toString()),
      idempotencyKey: text("idempotency_key").notNull(),
      organizationId: text("organization_id").notNull(),
      sandboxInstanceId: text("sandbox_instance_id")
        .notNull()
        .references(() => input.sandboxInstances.id, { onDelete: "cascade" }),
      computeGeneration: bigint("compute_generation", { mode: "number" }),
      eventType: text("event_type").notNull().$type<SandboxUsageEventType>(),
      occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "string" }).notNull(),
      runtimeProvider: text("runtime_provider").$type<SandboxInstanceProvider>(),
      providerSandboxId: text("provider_sandbox_id"),
      storageProvider: text("storage_provider").$type<SandboxStorageProvider>(),
      providerStorageId: text("provider_storage_id"),
      vcpuCount: bigint("vcpu_count", { mode: "number" }),
      memoryMb: bigint("memory_mb", { mode: "number" }),
      storageMb: bigint("storage_mb", { mode: "number" }),
      payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
      createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
        .notNull()
        .defaultNow(),
    },
    (table) => [
      uniqueIndex("sandbox_usage_events_idempotency_key_uidx").on(table.idempotencyKey),
      index("sandbox_usage_events_org_occurred_idx").on(table.organizationId, table.occurredAt),
      index("sandbox_usage_events_instance_occurred_idx").on(
        table.sandboxInstanceId,
        table.occurredAt,
      ),
      index("sandbox_usage_events_type_occurred_idx").on(table.eventType, table.occurredAt),
    ],
  );
}

export const sandboxUsageEvents = defineSandboxUsageEvents({
  schema: dataPlaneSchema,
  sandboxInstances,
});

export type SandboxUsageEvent = typeof sandboxUsageEvents.$inferSelect;
export type InsertSandboxUsageEvent = typeof sandboxUsageEvents.$inferInsert;
