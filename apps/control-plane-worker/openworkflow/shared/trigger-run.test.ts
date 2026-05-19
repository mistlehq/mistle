import { describe, expect, it } from "vitest";

import {
  TriggerRunFailureCodes,
  createTriggerRunExecutionError,
  isTriggerRunExecutionFailure,
  resolveTriggerRunFailure,
} from "./trigger-run.js";

describe("trigger run failure resolution", () => {
  it("resolves explicit trigger run failures wrapped by durable step errors", () => {
    const originalError = createTriggerRunExecutionError({
      code: TriggerRunFailureCodes.TRIGGER_RUN_EXECUTION_FAILED,
      message: "Sandbox startup failed before connection acquisition.",
    });
    const stepError = new Error("durable step failed");
    stepError.name = "StepError";
    Object.defineProperties(stepError, {
      originalError: {
        value: originalError,
      },
      retryPolicy: {
        value: {
          maximumAttempts: 10,
        },
      },
      stepFailedAttempts: {
        value: 1,
      },
    });

    expect(isTriggerRunExecutionFailure(stepError)).toBe(true);
    expect(resolveTriggerRunFailure(stepError)).toEqual({
      code: TriggerRunFailureCodes.TRIGGER_RUN_EXECUTION_FAILED,
      message: "Sandbox startup failed before connection acquisition.",
    });
  });

  it("keeps ordinary durable step failures as generic trigger execution failures", () => {
    const stepError = new Error("provider connection dropped");
    stepError.name = "StepError";
    Object.defineProperties(stepError, {
      retryPolicy: {
        value: {
          maximumAttempts: 10,
        },
      },
      stepFailedAttempts: {
        value: 1,
      },
    });

    expect(isTriggerRunExecutionFailure(stepError)).toBe(false);
    expect(resolveTriggerRunFailure(stepError)).toEqual({
      code: TriggerRunFailureCodes.TRIGGER_RUN_EXECUTION_FAILED,
      message: "provider connection dropped",
    });
  });

  it("resolves serialized trigger run failures wrapped by durable step errors", () => {
    const stepError = new Error("durable step failed");
    stepError.name = "StepError";
    Object.defineProperties(stepError, {
      originalError: {
        value: {
          code: TriggerRunFailureCodes.TEMPLATE_RENDER_FAILED,
          message: "Rendered trigger input template must not be empty.",
        },
      },
      retryPolicy: {
        value: {
          maximumAttempts: 10,
        },
      },
      stepFailedAttempts: {
        value: 1,
      },
    });

    expect(isTriggerRunExecutionFailure(stepError)).toBe(true);
    expect(resolveTriggerRunFailure(stepError)).toEqual({
      code: TriggerRunFailureCodes.TEMPLATE_RENDER_FAILED,
      message: "Rendered trigger input template must not be empty.",
    });
  });
});
