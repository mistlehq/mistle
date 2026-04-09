import { runWithWorkflowTraceContext } from "@mistle/telemetry";
import { defineWorkflow, type Workflow } from "openworkflow";

import { getOpenWorkflowRuntime } from "./runtime.js";

const DataPlaneWorkerServiceName = "@mistle/data-plane-worker";

export function defineTracedDataPlaneWorkflow<Input, Output, RawInput = Input>(
  spec: Workflow<Input, Output, RawInput>["spec"],
  fn: Workflow<Input, Output, RawInput>["fn"],
): Workflow<Input, Output, RawInput> {
  return defineWorkflow(spec, async (params) => {
    const runtime = await getOpenWorkflowRuntime();
    const workflowRun = await runtime.backend.getWorkflowRun({
      workflowRunId: params.run.id,
    });

    if (workflowRun === null) {
      throw new Error(`Expected workflow run '${params.run.id}' to exist before execution.`);
    }

    return runWithWorkflowTraceContext({
      fn: async () => fn(params),
      serviceName: DataPlaneWorkerServiceName,
      spanName: spec.name,
      workflowRunContext: workflowRun.context,
      workflowRunId: workflowRun.id,
      workflowVersion: params.version,
    });
  });
}
