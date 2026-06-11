export const ProviderResourceAssociationDeliveryFailureCodes = {
  ASSOCIATION_NOT_FOUND: "provider_resource_association_not_found",
  DELIVERY_NOT_ACTIVE: "provider_resource_association_delivery_not_active",
  DELIVERY_NOT_FOUND: "provider_resource_association_delivery_not_found",
  DELIVERY_NOT_CLAIMED: "provider_resource_association_delivery_not_claimed",
  DELIVERY_STATUS_NOT_TERMINAL: "provider_resource_association_delivery_status_not_terminal",
  ROUTING_CONVERSATION_NOT_FOUND: "provider_resource_association_routing_conversation_not_found",
  ROUTING_CONVERSATION_UNBOUND: "provider_resource_association_routing_conversation_unbound",
  ROUTING_EVENT_NOT_ENABLED: "provider_resource_association_routing_event_not_enabled",
  SANDBOX_NOT_FOUND: "provider_resource_association_sandbox_not_found",
  RUNTIME_PLAN_NOT_FOUND: "provider_resource_association_runtime_plan_not_found",
  RUNTIME_PLAN_AGENT_RUNTIME_NOT_FOUND:
    "provider_resource_association_runtime_plan_agent_runtime_not_found",
  RUNTIME_PLAN_WORKING_DIRECTORY_NOT_FOUND:
    "provider_resource_association_runtime_plan_working_directory_not_found",
  PROVIDER_DELIVERY_FAILED: "provider_resource_association_provider_delivery_failed",
} as const;

export type ProviderResourceAssociationDeliveryFailureCode =
  (typeof ProviderResourceAssociationDeliveryFailureCodes)[keyof typeof ProviderResourceAssociationDeliveryFailureCodes];

export class ProviderResourceAssociationDeliveryError extends Error {
  readonly code: ProviderResourceAssociationDeliveryFailureCode;

  constructor(input: {
    code: ProviderResourceAssociationDeliveryFailureCode;
    message: string;
    cause?: unknown;
  }) {
    super(input.message, input.cause === undefined ? undefined : { cause: input.cause });
    this.name = "ProviderResourceAssociationDeliveryError";
    this.code = input.code;
  }
}
