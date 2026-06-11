import type { AgentRuntimeCapabilities } from "./types.js";

type AgentRuntimeCapabilityDescriptor = {
  capabilities?: AgentRuntimeCapabilities;
};

export function supportsAssociatedResourceDeliveryRuntime(
  agentRuntime: AgentRuntimeCapabilityDescriptor,
): boolean {
  return agentRuntime.capabilities?.associatedResourceDelivery?.supported === true;
}
