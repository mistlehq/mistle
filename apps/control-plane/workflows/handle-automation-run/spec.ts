import { defineWorkflowSpec } from "openworkflow";

export type HandleAutomationRunWorkflowInput = {
  automationRunId: string;
};

export type HandleAutomationRunWorkflowOutput = {
  automationRunId: string;
};

export const HandleAutomationRunWorkflowSpec = defineWorkflowSpec<
  HandleAutomationRunWorkflowInput,
  HandleAutomationRunWorkflowOutput
>({
  name: "control-plane.automations.handle-run",
  version: "1",
});
