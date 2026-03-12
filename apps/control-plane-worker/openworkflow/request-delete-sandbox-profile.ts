import {
  createRequestDeleteSandboxProfileWorkflow,
  RequestDeleteSandboxProfileWorkflowSpec,
} from "@mistle/workflows/control-plane";
import { defineWorkflow } from "openworkflow";

import { getWorkflowContext } from "../src/openworkflow/context.js";

export const RequestDeleteSandboxProfileWorkflow = defineWorkflow(
  RequestDeleteSandboxProfileWorkflowSpec,
  async (workflowContext) => {
    const {
      services: { sandboxProfiles },
    } = await getWorkflowContext();
    const workflow = createRequestDeleteSandboxProfileWorkflow(sandboxProfiles);

    return workflow.fn(workflowContext);
  },
);
