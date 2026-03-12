import type {
  AutomationConversationDeliveryTask,
  ControlPlaneDatabase,
  ControlPlaneTransaction,
} from "@mistle/db/control-plane";

import type {
  AcquiredAutomationConnection,
  AcquireAutomationConnectionDependencies,
  EnsuredAutomationSandbox,
  EnsureAutomationSandboxDependencies,
  PreparedAutomationRun,
} from "../shared/automation/index.js";

export type HandleAutomationConversationDeliveryWorkflowInput = {
  conversationId: string;
  generation: number;
};

export type HandleAutomationConversationDeliveryWorkflowOutput = {
  conversationId: string;
  generation: number;
};

export const ActiveAutomationConversationDeliveryTaskStatuses = {
  CLAIMED: "claimed",
  DELIVERING: "delivering",
} as const;

export type ActiveAutomationConversationDeliveryTaskStatus =
  (typeof ActiveAutomationConversationDeliveryTaskStatuses)[keyof typeof ActiveAutomationConversationDeliveryTaskStatuses];

export type ActiveAutomationConversationDeliveryTask = {
  taskId: string;
  automationRunId: string;
  status: ActiveAutomationConversationDeliveryTaskStatus;
};

export type ResolvedAutomationConversationDeliveryRoute = {
  conversationId: string;
  integrationFamilyId: string;
  routeId: string | null;
  sandboxInstanceId: string | null;
  providerConversationId: string | null;
  providerExecutionId: string | null;
  providerState: unknown;
};

export type ConversationDeliveryExecutionInput = {
  taskId: string;
  generation: number;
  preparedAutomationRun: PreparedAutomationRun;
  resolvedAutomationConversationRoute: ResolvedAutomationConversationDeliveryRoute;
  ensuredAutomationSandbox: EnsuredAutomationSandbox;
  acquiredAutomationConnection: AcquiredAutomationConnection;
};

export type HandleAutomationConversationDeliveryDependencies = {
  db: ControlPlaneDatabase;
  startSandboxProfileInstance: EnsureAutomationSandboxDependencies["startSandboxProfileInstance"];
  getSandboxInstance: AcquireAutomationConnectionDependencies["getSandboxInstance"];
  mintSandboxConnectionToken: AcquireAutomationConnectionDependencies["mintSandboxConnectionToken"];
};

export type ExecuteConversationProviderDeliveryInput = {
  requestId: string;
  conversationId: string;
  integrationFamilyId: string;
  connectionUrl: string;
  inputText: string;
  providerConversationId: string | null;
  providerExecutionId: string | null;
};

export type ExecutedConversationProviderDelivery = {
  providerConversationId: string;
  providerExecutionId: string | null;
  providerState?: unknown;
};

export type AutomationConversationPersistenceDependencies = {
  db: ControlPlaneDatabase | ControlPlaneTransaction;
};

export const AutomationConversationDeliveryTaskActions = {
  DELIVER: "deliver",
  IGNORE: "ignore",
} as const;

export type AutomationConversationDeliveryTaskAction =
  (typeof AutomationConversationDeliveryTaskActions)[keyof typeof AutomationConversationDeliveryTaskActions];

export type ActiveConversationDeliveryTask = Pick<
  AutomationConversationDeliveryTask,
  "id" | "conversationId" | "processorGeneration" | "sourceOrderKey" | "status"
>;

export const AutomationConversationDeliverySandboxActions = {
  REUSE_EXISTING: "reuse_existing",
  START_NEW: "start_new",
  FAIL: "fail",
} as const;

export type ConversationDeliverySandboxAction =
  (typeof AutomationConversationDeliverySandboxActions)[keyof typeof AutomationConversationDeliverySandboxActions];

export const AutomationConversationRouteBindingActions = {
  CREATE_ROUTE: "create_route",
  ACTIVATE_PENDING_ROUTE: "activate_pending_route",
  REUSE_ACTIVE_ROUTE: "reuse_active_route",
  FAIL_SANDBOX_MISMATCH: "fail_sandbox_mismatch",
} as const;

export type AutomationConversationRouteBindingAction =
  (typeof AutomationConversationRouteBindingActions)[keyof typeof AutomationConversationRouteBindingActions];
