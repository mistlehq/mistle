import { describe, expect } from "vitest";

import { HandleIntegrationWebhookEventWorkflowSpec } from "../../src/control-plane/index.js";
import { it } from "./test-context.js";

describe("handle integration webhook event workflow integration", () => {
  it("executes the no-op webhook handler workflow", async ({ fixture }) => {
    const workflowHandle = await fixture.openWorkflow.runWorkflow(
      HandleIntegrationWebhookEventWorkflowSpec,
      {
        webhookEventId: "iwe_test_webhook_event_1",
      },
    );
    const workflowResult = await workflowHandle.result();

    expect(workflowResult).toEqual({
      webhookEventId: "iwe_test_webhook_event_1",
    });
  });
});
