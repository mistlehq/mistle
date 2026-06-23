import { index, jsonb, text, timestamp, uniqueIndex, type PgSchema } from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { controlPlaneSchema } from "./namespace.js";
import { organizations } from "./organizations.js";

export type DesignerBlueprintItemState =
  | "proposed"
  | "needs_setup"
  | "ready_to_confirm"
  | "applied"
  | "blocked";

export type DesignerBlueprintStandardItemKind = "agent_step" | "workflow_output";

export type DesignerBlueprintRoutingCondition = {
  field: string;
  operator: "equals" | "not_equals" | "includes" | "excludes" | "in" | "empty" | "not_empty";
  value?: string | string[] | number | boolean | undefined;
};

export type DesignerBlueprintRoutingRule = {
  label?: string | undefined;
  when: DesignerBlueprintRoutingCondition[];
  routeTo?: string | undefined;
};

export type DesignerBlueprintStandardItem = {
  id: string;
  kind: DesignerBlueprintStandardItemKind;
  label: string;
  description?: string | undefined;
  parentId?: string | undefined;
  state: DesignerBlueprintItemState;
};

export type DesignerBlueprintTriggerItem = {
  id: string;
  kind: "trigger";
  label: string;
  description?: string | undefined;
  parentId?: string | undefined;
  state: DesignerBlueprintItemState;
  integrationLabel?: string | undefined;
  eventLabel?: string | undefined;
};

export type DesignerBlueprintRoutingPolicyItem = {
  id: string;
  kind: "routing_policy";
  label: string;
  description?: string | undefined;
  parentId?: string | undefined;
  state: DesignerBlueprintItemState;
  rules: DesignerBlueprintRoutingRule[];
};

export type DesignerBlueprintItem =
  | DesignerBlueprintStandardItem
  | DesignerBlueprintTriggerItem
  | DesignerBlueprintRoutingPolicyItem;

export type DesignerBlueprintDocument = {
  version: 1;
  title: string;
  outcome: {
    label: string;
    description?: string | undefined;
  };
  items: DesignerBlueprintItem[];
  links: {
    from: string;
    to: string;
    kind:
      | "requires"
      | "triggers"
      | "configures"
      | "produces"
      | "confirms"
      | "routes_to"
      | "hands_off_to"
      | "uses";
  }[];
  actions: {
    id: string;
    itemId: string;
    kind:
      | "open_integration_setup"
      | "open_trigger_create"
      | "open_trigger_edit"
      | "open_sandbox_profile"
      | "open_sandbox_profile_section";
    label: string;
    href: string;
  }[];
};

export type DesignerSessionRouteCanvasTab = {
  kind: "route";
  id: string;
  title: string;
  href: string;
};

export type DesignerSessionBlueprintCanvasTab = {
  kind: "blueprint";
  id: "designer-blueprint-current";
  title: string;
  href: "/designer/blueprints/current";
  blueprint: DesignerBlueprintDocument;
};

export type DesignerSessionCanvasTab =
  | DesignerSessionRouteCanvasTab
  | DesignerSessionBlueprintCanvasTab;

export type DesignerSessionCanvasTabs = DesignerSessionCanvasTab[];

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
