import { defineWorkflow, type Workflow } from "openworkflow";

import {
  HandleConversationDeliveryWorkflowSpec,
  type HandleConversationDeliveryWorkflowInput,
  type HandleConversationDeliveryWorkflowOutput,
} from "./spec.js";

export type CreateHandleConversationDeliveryWorkflowInput = {
  handleConversationDelivery: (
    input: HandleConversationDeliveryWorkflowInput,
  ) => Promise<HandleConversationDeliveryWorkflowOutput>;
};

export function createHandleConversationDeliveryWorkflow(
  input: CreateHandleConversationDeliveryWorkflowInput,
): Workflow<
  HandleConversationDeliveryWorkflowInput,
  HandleConversationDeliveryWorkflowOutput,
  HandleConversationDeliveryWorkflowInput
> {
  return defineWorkflow(
    HandleConversationDeliveryWorkflowSpec,
    async ({ input: workflowInput, step }) => {
      return step.run({ name: "handle-conversation-delivery" }, async () =>
        input.handleConversationDelivery(workflowInput),
      );
    },
  );
}
