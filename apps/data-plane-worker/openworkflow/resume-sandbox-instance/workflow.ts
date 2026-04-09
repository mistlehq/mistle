import {
  ResumeSandboxInstanceWorkflowSpec,
  type ResumeSandboxInstanceWorkflowOutput,
} from "@mistle/workflow-registry/data-plane";

import { getWorkflowContext } from "../core/context.js";
import { defineTracedDataPlaneWorkflow } from "../core/tracing.js";
import { resumeSandboxInstance } from "./resume-sandbox-instance.js";

export const ResumeSandboxInstanceWorkflow = defineTracedDataPlaneWorkflow(
  ResumeSandboxInstanceWorkflowSpec,
  async ({ input, step }): Promise<ResumeSandboxInstanceWorkflowOutput> => {
    const ctx = await getWorkflowContext();

    await step.run({ name: "resume-sandbox-instance" }, async () => {
      await resumeSandboxInstance(
        {
          config: ctx.config,
          db: ctx.db,
          sandboxAdapter: ctx.sandboxAdapter,
          sandboxRuntimeControl: ctx.sandboxRuntimeControl,
          runtimeStateReader: ctx.runtimeStateReader,
          tunnelReadinessPolicy: ctx.tunnelReadinessPolicy,
          clock: ctx.clock,
          sleeper: ctx.sleeper,
        },
        {
          sandboxInstanceId: input.sandboxInstanceId,
        },
      );
    });

    return {
      sandboxInstanceId: input.sandboxInstanceId,
    };
  },
);
