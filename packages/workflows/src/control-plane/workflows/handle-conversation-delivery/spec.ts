import { defineWorkflowSpec } from "openworkflow";

export type HandleConversationDeliveryWorkflowInput = {
  conversationId: string;
  generation: number;
};

export type HandleConversationDeliveryWorkflowOutput = {
  conversationId: string;
  generation: number;
};

export const HandleConversationDeliveryWorkflowSpec = defineWorkflowSpec<
  HandleConversationDeliveryWorkflowInput,
  HandleConversationDeliveryWorkflowOutput
>({
  name: "control-plane.conversations.handle-delivery",
  version: "1",
});
