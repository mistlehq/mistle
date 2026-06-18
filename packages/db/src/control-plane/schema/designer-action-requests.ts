import { index, jsonb, text, timestamp, uniqueIndex, type PgSchema } from "drizzle-orm/pg-core";
import { typeid } from "typeid-js";

import { designerSessions } from "./designer-sessions.js";
import { controlPlaneSchema } from "./namespace.js";
import { organizations } from "./organizations.js";

export const DesignerActionRequestResponses = {
  APPROVED: "approved",
  DECLINED: "declined",
} as const;

export type DesignerActionRequestResponse =
  (typeof DesignerActionRequestResponses)[keyof typeof DesignerActionRequestResponses];

export const DesignerActionRequestOperationKinds = {
  PROVIDER_CONFIGURATION_CHANGE: "providerConfigurationChange",
  SANDBOX_PROFILE_DRAFT_PUBLISH: "sandboxProfileDraftPublish",
  SANDBOX_PROFILE_DRAFT_SETUP_SCRIPT_PUT: "sandboxProfileDraftSetupScriptPut",
  SANDBOX_PROFILE_VERSION_LAUNCH: "sandboxProfileVersionLaunch",
} as const;

export type DesignerActionRequestOperationKind =
  (typeof DesignerActionRequestOperationKinds)[keyof typeof DesignerActionRequestOperationKinds];

export type DesignerProviderConfigurationChangeOperation = {
  kind: typeof DesignerActionRequestOperationKinds.PROVIDER_CONFIGURATION_CHANGE;
  provider: string;
  resourceType: string;
  resourceLabel: string | null;
  action: string;
  details: readonly {
    label: string;
    value: string;
  }[];
};

export type DesignerSandboxProfileDraftSetupScriptPutOperation = {
  kind: typeof DesignerActionRequestOperationKinds.SANDBOX_PROFILE_DRAFT_SETUP_SCRIPT_PUT;
  profileId: string;
  version: number;
  setupScript: string | null;
};

export type DesignerSandboxProfileDraftPublishOperation = {
  kind: typeof DesignerActionRequestOperationKinds.SANDBOX_PROFILE_DRAFT_PUBLISH;
  profileId: string;
  version: number;
};

export type DesignerSandboxProfileVersionLaunchOperation = {
  kind: typeof DesignerActionRequestOperationKinds.SANDBOX_PROFILE_VERSION_LAUNCH;
  profileId: string;
  version: number;
  primaryRepositoryId?: string | null;
  idempotencyKey: string;
};

export type DesignerActionRequestOperation =
  | DesignerProviderConfigurationChangeOperation
  | DesignerSandboxProfileDraftPublishOperation
  | DesignerSandboxProfileDraftSetupScriptPutOperation
  | DesignerSandboxProfileVersionLaunchOperation;

export const DesignerActionRequestStatuses = {
  APPROVED: "approved",
  DECLINED: "declined",
  EXECUTING: "executing",
  EXECUTION_UNSUPPORTED: "execution_unsupported",
  COMPLETED: "completed",
  FAILED: "failed",
} as const;

export type DesignerActionRequestStatus =
  (typeof DesignerActionRequestStatuses)[keyof typeof DesignerActionRequestStatuses];

export function defineDesignerActionRequests(schema: PgSchema) {
  return schema.table(
    "designer_action_requests",
    {
      id: text("id")
        .primaryKey()
        .$defaultFn(() => typeid("dar").toString()),
      organizationId: text("organization_id")
        .notNull()
        .references(() => organizations.id, { onDelete: "cascade" }),
      designerSessionId: text("designer_session_id")
        .notNull()
        .references(() => designerSessions.id, { onDelete: "cascade" }),
      proposalId: text("proposal_id").notNull(),
      response: text("response").notNull().$type<DesignerActionRequestResponse>(),
      responseIdempotencyKey: text("response_idempotency_key").notNull(),
      operationKind: text("operation_kind").notNull().$type<DesignerActionRequestOperationKind>(),
      operation: jsonb("operation").$type<DesignerActionRequestOperation>().notNull(),
      status: text("status").notNull().$type<DesignerActionRequestStatus>(),
      requestedByUserId: text("requested_by_user_id").notNull(),
      runtimeProviderConversationId: text("runtime_provider_conversation_id").notNull(),
      runtimeProviderExecutionId: text("runtime_provider_execution_id"),
      responseSubmittedAt: timestamp("response_submitted_at", {
        withTimezone: true,
        mode: "string",
      }),
      failureCode: text("failure_code"),
      failureMessage: text("failure_message"),
      createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
        .notNull()
        .defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
        .notNull()
        .defaultNow(),
    },
    (table) => [
      uniqueIndex("designer_action_requests_session_proposal_uidx").on(
        table.designerSessionId,
        table.proposalId,
      ),
      index("designer_action_requests_org_session_idx").on(
        table.organizationId,
        table.designerSessionId,
      ),
      index("designer_action_requests_status_idx").on(table.status),
    ],
  );
}

export const designerActionRequests = defineDesignerActionRequests(controlPlaneSchema);

export type DesignerActionRequest = typeof designerActionRequests.$inferSelect;
export type InsertDesignerActionRequest = typeof designerActionRequests.$inferInsert;
