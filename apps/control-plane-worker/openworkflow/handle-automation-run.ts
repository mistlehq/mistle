import { HandleAutomationRunWorkflowSpec } from "@mistle/workflow-registry/control-plane";
import { defineWorkflow } from "openworkflow";

import { getWorkflowContext } from "../src/openworkflow/context.js";

export const HandleAutomationRunWorkflow = defineWorkflow(
  HandleAutomationRunWorkflowSpec,
  async ({ input, step }) => {
    const {
      services: { automationRuns },
    } = await getWorkflowContext();

    const transitionResult = await step.run(
      { name: "transition-automation-run-to-running" },
      async () => automationRuns.transitionAutomationRunToRunning(input),
    );
    if (!transitionResult.shouldProcess) {
      return {
        automationRunId: input.automationRunId,
      };
    }

    try {
      const preparedAutomationRun = await step.run({ name: "prepare-automation-run" }, async () =>
        automationRuns.prepareAutomationRun(input),
      );

      await step.run({ name: "handoff-automation-run-delivery" }, async () =>
        automationRuns.handoffAutomationRunDelivery({
          preparedAutomationRun,
        }),
      );
    } catch (error) {
      const failure = automationRuns.resolveAutomationRunFailure({
        error,
      });
      await step.run({ name: "mark-automation-run-failed" }, async () =>
        automationRuns.markAutomationRunFailed({
          automationRunId: input.automationRunId,
          failureCode: failure.code,
          failureMessage: failure.message,
        }),
      );
      throw error;
    }

    return {
      automationRunId: input.automationRunId,
    };
  },
);
