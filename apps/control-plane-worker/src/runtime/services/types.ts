import type {
  AcquiredAutomationConnection,
  EnsuredAutomationSandbox,
  PreparedAutomationRun,
  ResolvedAutomationConversationDeliveryRoute,
} from "../workflow-types.js";

export type DeliverAutomationPayloadServiceInput = {
  preparedAutomationRun: PreparedAutomationRun;
  ensuredAutomationSandbox: EnsuredAutomationSandbox;
  acquiredAutomationConnection: AcquiredAutomationConnection;
};
export type DeliverAutomationConversationPayloadServiceInput = {
  preparedAutomationRun: PreparedAutomationRun;
  resolvedAutomationConversationRoute: ResolvedAutomationConversationDeliveryRoute;
  ensuredAutomationSandbox: EnsuredAutomationSandbox;
  acquiredAutomationConnection: AcquiredAutomationConnection;
};
