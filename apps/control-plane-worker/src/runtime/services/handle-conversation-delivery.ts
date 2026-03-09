import type {
  HandleConversationDeliveryWorkflowInput,
  HandleConversationDeliveryWorkflowOutput,
} from "@mistle/workflows/control-plane";

export type HandleConversationDeliveryServiceInput = HandleConversationDeliveryWorkflowInput;
export type HandleConversationDeliveryServiceOutput = HandleConversationDeliveryWorkflowOutput;

export async function handleConversationDelivery(
  input: HandleConversationDeliveryServiceInput,
): Promise<HandleConversationDeliveryServiceOutput> {
  return {
    conversationId: input.conversationId,
    generation: input.generation,
  };
}
