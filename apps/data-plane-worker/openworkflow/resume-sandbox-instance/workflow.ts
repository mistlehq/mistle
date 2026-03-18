import {
  ResumeSandboxInstanceWorkflowSpec,
  type ResumeSandboxInstanceWorkflowOutput,
} from "@mistle/workflow-registry/data-plane";
import { defineWorkflow } from "openworkflow";

import { getWorkflowContext } from "../core/context.js";
import { resumeSandboxInstance } from "./resume-sandbox-instance.js";

export const ResumeSandboxInstanceWorkflow = defineWorkflow(
  ResumeSandboxInstanceWorkflowSpec,
  async ({ input, step }): Promise<ResumeSandboxInstanceWorkflowOutput> => {
    const ctx = await getWorkflowContext();

    await step.run({ name: "resume-sandbox-instance" }, async () => {
      await resumeSandboxInstance(
        {
          config: ctx.config,
          db: ctx.db,
          sandboxAdapter: ctx.sandboxAdapter,
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
