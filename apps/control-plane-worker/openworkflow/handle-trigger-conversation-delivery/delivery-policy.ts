import type {
  AgentRuntimeConversationDeliveryCapability,
  AgentRuntimeReader,
} from "@mistle/integrations-core";

class TriggerConversationDeliveryPolicyError extends Error {}

export function resolveAgentRuntimeConversationDeliveryPolicy(
  ctx: {
    agentRuntimeRegistry: AgentRuntimeReader;
  },
  input: {
    runtimeId: string;
  },
): AgentRuntimeConversationDeliveryCapability {
  const runtimeDefinition = ctx.agentRuntimeRegistry.getRuntime({
    runtimeId: input.runtimeId,
  });
  if (runtimeDefinition === undefined) {
    throw new TriggerConversationDeliveryPolicyError(
      `Agent runtime '${input.runtimeId}' was not found while resolving trigger conversation delivery policy.`,
    );
  }

  const conversationDeliveryPolicy = runtimeDefinition.capabilities?.conversationDelivery;
  if (conversationDeliveryPolicy === undefined) {
    throw new TriggerConversationDeliveryPolicyError(
      `Agent runtime '${input.runtimeId}' does not define trigger conversation delivery policy.`,
    );
  }

  return conversationDeliveryPolicy;
}
