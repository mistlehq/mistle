import { describe, expect } from "vitest";

import { HandleAutomationRunWorkflowSpec } from "../../src/control-plane/index.js";
import { it } from "./test-context.js";

describe("handle automation run workflow integration", () => {
  it("executes the automation run handler workflow", async ({ fixture }) => {
    const workflowHandle = await fixture.openWorkflow.runWorkflow(HandleAutomationRunWorkflowSpec, {
      automationRunId: "aru_test_automation_run_1",
    });
    const workflowResult = await workflowHandle.result();

    expect(workflowResult).toEqual({
      automationRunId: "aru_test_automation_run_1",
    });
  });
});
