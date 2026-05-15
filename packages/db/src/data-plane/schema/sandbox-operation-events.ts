import {
  bigint,
  customType,
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

const bytea = customType<{
  data: Buffer;
  driverData: Buffer;
}>({
  dataType() {
    return "bytea";
  },
});

export const SandboxOperationKinds = {
  START: "start",
  RESUME: "resume",
  SETUP_CHECK: "setup_check",
  SNAPSHOT: "snapshot",
  STOP: "stop",
} as const;

export type SandboxOperationKind =
  (typeof SandboxOperationKinds)[keyof typeof SandboxOperationKinds];

export const SandboxOperationEventRecordKinds = {
  LIFECYCLE: "lifecycle",
  TRANSCRIPT: "transcript",
} as const;

export type SandboxOperationEventRecordKind =
  (typeof SandboxOperationEventRecordKinds)[keyof typeof SandboxOperationEventRecordKinds];

export const SandboxOperationEventSources = {
  WORKER: "worker",
  GATEWAY: "gateway",
  SANDBOXD: "sandboxd",
} as const;

export type SandboxOperationEventSource =
  (typeof SandboxOperationEventSources)[keyof typeof SandboxOperationEventSources];

export const SandboxLifecyclePhases = {
  PROVIDER: "provider",
  STORAGE_PROVISION: "storage_provision",
  STORAGE_ATTACH: "storage_attach",
  SANDBOXD: "sandboxd",
  OPERATION_STREAM: "operation_stream",
  GIT_IDENTITY: "git_identity",
  EGRESS: "egress",
  RUNTIME_PLAN: "runtime_plan",
  SETUP_SCRIPT: "setup_script",
  RUNTIME_PROCESSES: "runtime_processes",
  RUNTIME_ADAPTERS: "runtime_adapters",
  AGENT_ENDPOINT: "agent_endpoint",
  READY: "ready",
  RUNNING: "running",
  SNAPSHOT: "snapshot",
  STOP: "stop",
  TEARDOWN: "teardown",
} as const;

export type SandboxLifecyclePhase =
  (typeof SandboxLifecyclePhases)[keyof typeof SandboxLifecyclePhases];

export const SandboxLifecycleStatuses = {
  STARTED: "started",
  COMPLETED: "completed",
  FAILED: "failed",
  WARNING: "warning",
} as const;

export type SandboxLifecycleStatus =
  (typeof SandboxLifecycleStatuses)[keyof typeof SandboxLifecycleStatuses];

export const SandboxOperationTranscriptStreams = {
  STDOUT: "stdout",
  STDERR: "stderr",
  SYSTEM: "system",
} as const;

export type SandboxOperationTranscriptStream =
  (typeof SandboxOperationTranscriptStreams)[keyof typeof SandboxOperationTranscriptStreams];

export function defineSandboxOperationEvents(input: {
  schema: PgSchema;
  sandboxInstances: ReturnType<typeof defineSandboxInstances>;
}) {
  return input.schema.table(
    "sandbox_operation_events",
    {
      id: text("id")
        .primaryKey()
        .$defaultFn(() => typeid("soe").toString()),
      sandboxInstanceId: text("sandbox_instance_id")
        .notNull()
        .references(() => input.sandboxInstances.id, { onDelete: "cascade" }),
      operationKind: text("operation_kind").notNull().$type<SandboxOperationKind>(),
      operationId: text("operation_id").notNull(),
      sequence: bigint("sequence", { mode: "number" }).notNull(),
      recordKind: text("record_kind").notNull().$type<SandboxOperationEventRecordKind>(),
      observedAt: timestamp("observed_at", { withTimezone: true, mode: "string" }).notNull(),
      source: text("source").notNull().$type<SandboxOperationEventSource>(),
      phase: text("phase").$type<SandboxLifecyclePhase>(),
      status: text("status").$type<SandboxLifecycleStatus>(),
      stream: text("stream").$type<SandboxOperationTranscriptStream>(),
      message: text("message").notNull(),
      payloadBytes: bytea("payload_bytes"),
      attributes: jsonb("attributes").$type<Record<string, unknown>>().notNull(),
      createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
        .notNull()
        .defaultNow(),
    },
    (table) => [
      uniqueIndex("sandbox_operation_events_operation_sequence_uidx").on(
        table.sandboxInstanceId,
        table.operationId,
        table.sequence,
      ),
      index("sandbox_operation_events_instance_operation_idx").on(
        table.sandboxInstanceId,
        table.operationId,
      ),
      index("sandbox_operation_events_instance_created_idx").on(
        table.sandboxInstanceId,
        table.createdAt,
      ),
    ],
  );
}

export const sandboxOperationEvents = defineSandboxOperationEvents({
  schema: dataPlaneSchema,
  sandboxInstances,
});

export type SandboxOperationEvent = typeof sandboxOperationEvents.$inferSelect;
export type InsertSandboxOperationEvent = typeof sandboxOperationEvents.$inferInsert;
