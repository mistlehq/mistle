import { defineWorkflow, type Workflow } from "openworkflow";

import {
  HandleAutomationRunWorkflowSpec,
  type HandleAutomationRunWorkflowInput,
  type HandleAutomationRunWorkflowOutput,
} from "./spec.js";

export type HandleAutomationRunTransitionResult = {
  shouldProcess: boolean;
};

export type HandleAutomationRunFailure = {
  code: string;
  message: string;
};

export type MarkAutomationRunFailedInput = {
  automationRunId: string;
  failureCode: string;
  failureMessage: string;
};

export type CreateHandleAutomationRunWorkflowInput = {
  transitionAutomationRunToRunning: (
    input: HandleAutomationRunWorkflowInput,
  ) => Promise<HandleAutomationRunTransitionResult>;
  prepareAutomationRun: (input: HandleAutomationRunWorkflowInput) => Promise<void>;
  markAutomationRunCompleted: (input: HandleAutomationRunWorkflowInput) => Promise<void>;
  markAutomationRunFailed: (input: MarkAutomationRunFailedInput) => Promise<void>;
  resolveAutomationRunFailure: (input: { error: unknown }) => HandleAutomationRunFailure;
};

export function createHandleAutomationRunWorkflow(
  input: CreateHandleAutomationRunWorkflowInput,
): Workflow<
  HandleAutomationRunWorkflowInput,
  HandleAutomationRunWorkflowOutput,
  HandleAutomationRunWorkflowInput
> {
  return defineWorkflow(HandleAutomationRunWorkflowSpec, async ({ input: workflowInput, step }) => {
    const transitionResult = await step.run(
      { name: "transition-automation-run-to-running" },
      async () => input.transitionAutomationRunToRunning(workflowInput),
    );
    if (!transitionResult.shouldProcess) {
      return {
        automationRunId: workflowInput.automationRunId,
      };
    }

    try {
      await step.run({ name: "prepare-automation-run" }, async () =>
        input.prepareAutomationRun(workflowInput),
      );

      await step.run({ name: "mark-automation-run-completed" }, async () =>
        input.markAutomationRunCompleted(workflowInput),
      );
    } catch (error) {
      const failure = input.resolveAutomationRunFailure({
        error,
      });
      await step.run({ name: "mark-automation-run-failed" }, async () =>
        input.markAutomationRunFailed({
          automationRunId: workflowInput.automationRunId,
          failureCode: failure.code,
          failureMessage: failure.message,
        }),
      );
      throw error;
    }

    return {
      automationRunId: workflowInput.automationRunId,
    };
  });
}
