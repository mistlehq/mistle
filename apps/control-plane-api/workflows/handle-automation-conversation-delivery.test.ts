import { expect, test } from "vitest";

import { HandleAutomationConversationDeliveryWorkflow } from "./handle-automation-conversation-delivery.js";

test("HandleAutomationConversationDeliveryWorkflow preserves the existing workflow identity", () => {
  expect(HandleAutomationConversationDeliveryWorkflow.spec.name).toBe(
    "control-plane.automation-conversations.handle-delivery",
  );
  expect(HandleAutomationConversationDeliveryWorkflow.spec.version).toBe("1");
});
