import { index, jsonb, text, timestamp, uniqueIndex, type PgSchema } from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { controlPlaneSchema } from "./namespace.js";
import { organizations } from "./organizations.js";

export type DesignerSessionCanvasTab = {
  id: string;
  title: string;
  href: string;
};

export type DesignerSessionCanvasTabs = readonly DesignerSessionCanvasTab[];

export function defineDesignerSessions(schema: PgSchema) {
  return schema.table(
    "designer_sessions",
    {
      id: text("id")
        .primaryKey()
        .$defaultFn(() => typeid("dsn").toString()),
      organizationId: text("organization_id")
        .notNull()
        .references(() => organizations.id, { onDelete: "cascade" }),
      sandboxInstanceId: text("sandbox_instance_id").notNull(),
      initialPrompt: text("initial_prompt"),
      runtimeProviderConversationId: text("runtime_provider_conversation_id"),
      initialPromptProviderExecutionId: text("initial_prompt_provider_execution_id"),
      initialPromptSubmittedAt: timestamp("initial_prompt_submitted_at", {
        withTimezone: true,
        mode: "string",
      }),
      canvasTabs: jsonb("canvas_tabs").$type<DesignerSessionCanvasTabs>().notNull().default([]),
      createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
        .notNull()
        .defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
        .notNull()
        .defaultNow(),
    },
    (table) => [
      uniqueIndex("designer_sessions_sandbox_instance_uidx").on(table.sandboxInstanceId),
      index("designer_sessions_org_updated_idx").on(table.organizationId, table.updatedAt),
    ],
  );
}

export const designerSessions = defineDesignerSessions(controlPlaneSchema);

export type DesignerSession = typeof designerSessions.$inferSelect;
export type InsertDesignerSession = typeof designerSessions.$inferInsert;
