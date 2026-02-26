import { index, jsonb, text, timestamp } from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { dataPlaneSchema } from "./namespace.js";
import { sandboxInstances } from "./sandbox-instances.js";

export const SandboxSnapshotArtifactKinds = {
  PROVIDER_IMAGE: "provider_image",
} as const;

export type SandboxSnapshotArtifactKind =
  (typeof SandboxSnapshotArtifactKinds)[keyof typeof SandboxSnapshotArtifactKinds];

export const sandboxInstanceSnapshots = dataPlaneSchema.table(
  "sandbox_instance_snapshots",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("sbs").toString()),
    organizationId: text("organization_id").notNull(),
    sourceInstanceId: text("source_instance_id").references(() => sandboxInstances.id, {
      onDelete: "set null",
    }),
    artifactKind: text("artifact_kind").notNull().$type<SandboxSnapshotArtifactKind>(),
    artifactRef: jsonb("artifact_ref").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("sandbox_instance_snapshots_organization_id_idx").on(table.organizationId),
    index("sandbox_instance_snapshots_org_source_instance_idx").on(
      table.organizationId,
      table.sourceInstanceId,
    ),
    index("sandbox_instance_snapshots_artifact_kind_idx").on(table.artifactKind),
    index("sandbox_instance_snapshots_source_instance_id_idx").on(table.sourceInstanceId),
  ],
);

export type SandboxInstanceSnapshot = typeof sandboxInstanceSnapshots.$inferSelect;
export type InsertSandboxInstanceSnapshot = typeof sandboxInstanceSnapshots.$inferInsert;
