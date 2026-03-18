import {
  ResumeSandboxInstanceWorkflowSpec,
  StartSandboxInstanceWorkflowSpec,
  StopSandboxInstanceWorkflowSpec,
} from "@mistle/workflow-registry/data-plane";
import { describe, expect, it } from "vitest";

import { ResumeSandboxInstanceWorkflow } from "./resume-sandbox-instance/workflow.js";
import { StartSandboxInstanceWorkflow } from "./start-sandbox-instance/workflow.js";
import { StopSandboxInstanceWorkflow } from "./stop-sandbox-instance/workflow.js";

describe("data-plane worker openworkflow entrypoints", () => {
  it("preserves the start sandbox instance workflow identity", () => {
    expect(StartSandboxInstanceWorkflow.spec).toMatchObject(StartSandboxInstanceWorkflowSpec);
  });

  it("preserves the resume sandbox instance workflow identity", () => {
    expect(ResumeSandboxInstanceWorkflow.spec).toMatchObject(ResumeSandboxInstanceWorkflowSpec);
  });

  it("preserves the stop sandbox instance workflow identity", () => {
    expect(StopSandboxInstanceWorkflow.spec).toMatchObject(StopSandboxInstanceWorkflowSpec);
  });
});
