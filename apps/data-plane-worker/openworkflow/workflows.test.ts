import {
  StartSandboxInstanceWorkflowSpec,
  StopSandboxInstanceWorkflowSpec,
} from "@mistle/workflow-registry/data-plane";
import { describe, expect, it } from "vitest";

import { StartSandboxInstanceWorkflow } from "./start-sandbox-instance/workflow.js";
import { StopSandboxInstanceWorkflow } from "./stop-sandbox-instance/workflow.js";

describe("data-plane worker openworkflow entrypoints", () => {
  it("preserves the start sandbox instance workflow identity", () => {
    expect(StartSandboxInstanceWorkflow.spec).toMatchObject(StartSandboxInstanceWorkflowSpec);
  });

  it("preserves the stop sandbox instance workflow identity", () => {
    expect(StopSandboxInstanceWorkflow.spec).toMatchObject(StopSandboxInstanceWorkflowSpec);
  });
});
