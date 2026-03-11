import { defineWorkflowSpec } from "openworkflow";

export type HandleAutomationConversationDeliveryWorkflowInput = {
  conversationId: string;
  generation: number;
};

export type HandleAutomationConversationDeliveryWorkflowOutput = {
  conversationId: string;
  generation: number;
};

export const HandleAutomationConversationDeliveryWorkflowSpec = defineWorkflowSpec<
  HandleAutomationConversationDeliveryWorkflowInput,
  HandleAutomationConversationDeliveryWorkflowOutput
>({
  name: "control-plane.automation-conversations.handle-delivery",
  version: "1",
});
