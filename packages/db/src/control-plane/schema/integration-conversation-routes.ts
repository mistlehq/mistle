import { index, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { controlPlaneSchema } from "./namespace.js";
import { organizations } from "./organizations.js";
import { sandboxProfileVersionIntegrationBindings } from "./sandbox-profile-version-integration-bindings.js";
import { sandboxProfiles } from "./sandbox-profiles.js";

export const integrationConversationRoutes = controlPlaneSchema.table(
  "integration_conversation_routes",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => typeid("icv").toString()),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    sandboxProfileId: text("sandbox_profile_id")
      .notNull()
      .references(() => sandboxProfiles.id, { onDelete: "cascade" }),
    sourceBindingId: text("source_binding_id")
      .notNull()
      .references(() => sandboxProfileVersionIntegrationBindings.id, { onDelete: "cascade" }),
    conversationKey: text("conversation_key").notNull(),
    sandboxInstanceId: text("sandbox_instance_id").notNull(),
    providerConversationId: text("provider_conversation_id").notNull(),
    status: text("status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("integration_conversation_routes_org_binding_key_uidx").on(
      table.organizationId,
      table.sourceBindingId,
      table.conversationKey,
    ),
    index("integration_conversation_routes_organization_id_idx").on(table.organizationId),
    index("integration_conversation_routes_sandbox_profile_id_idx").on(table.sandboxProfileId),
    index("integration_conversation_routes_source_binding_id_idx").on(table.sourceBindingId),
    index("integration_conversation_routes_sandbox_instance_id_idx").on(table.sandboxInstanceId),
  ],
);

export type IntegrationConversationRoute = typeof integrationConversationRoutes.$inferSelect;
export type InsertIntegrationConversationRoute = typeof integrationConversationRoutes.$inferInsert;
