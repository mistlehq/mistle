import { expect, test } from "vitest";

import { HandleAutomationRunWorkflow } from "./handle-automation-run.js";

test("HandleAutomationRunWorkflow preserves the existing workflow identity", () => {
  expect(HandleAutomationRunWorkflow.spec.name).toBe("control-plane.automations.handle-run");
  expect(HandleAutomationRunWorkflow.spec.version).toBe("1");
});
