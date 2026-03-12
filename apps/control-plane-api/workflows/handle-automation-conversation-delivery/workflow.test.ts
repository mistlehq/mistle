import { expect, test } from "vitest";

import { HandleAutomationConversationDeliveryWorkflow } from "./workflow.js";

test("HandleAutomationConversationDeliveryWorkflow preserves the existing workflow identity", () => {
  expect(HandleAutomationConversationDeliveryWorkflow.spec.name).toBe(
    "control-plane.automation-conversations.handle-delivery",
  );
  expect(HandleAutomationConversationDeliveryWorkflow.spec.version).toBe("1");
});
