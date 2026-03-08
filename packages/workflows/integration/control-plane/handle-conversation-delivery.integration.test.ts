import { describe, expect } from "vitest";

import { HandleConversationDeliveryWorkflowSpec } from "../../src/control-plane/index.js";
import { it } from "./test-context.js";

describe("handle conversation delivery workflow integration", () => {
  it("executes the conversation delivery handler workflow", async ({ fixture }) => {
    const workflowHandle = await fixture.openWorkflow.runWorkflow(
      HandleConversationDeliveryWorkflowSpec,
      {
        conversationId: "cnv_test_conversation_1",
        generation: 3,
      },
    );
    const workflowResult = await workflowHandle.result();

    expect(workflowResult).toEqual({
      conversationId: "cnv_test_conversation_1",
      generation: 3,
    });
  });
});
