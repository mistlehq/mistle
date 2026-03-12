import { StartSandboxInstanceWorkflowSpec } from "@mistle/workflow-registry/data-plane";
import { describe, expect, it } from "vitest";

import { StartSandboxInstanceWorkflow } from "./start-sandbox-instance.js";

describe("data-plane worker openworkflow entrypoints", () => {
  it("preserves the start sandbox instance workflow identity", () => {
    expect(StartSandboxInstanceWorkflow.spec).toMatchObject(StartSandboxInstanceWorkflowSpec);
  });
});
