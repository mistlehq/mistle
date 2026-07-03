import { describe, expect, it } from "vitest";

import {
  TriggerRunFailureCodes,
  createTriggerRunExecutionError,
  isPermanentTriggerRunExecutionFailure,
  isTriggerRunExecutionFailure,
  resolveTriggerRunFailure,
} from "./trigger-run.js";

function createDurableStepError(input: {
  message?: string | undefined;
  originalError?: unknown;
}): Error {
  const stepError = new Error(input.message ?? "durable step failed");
  stepError.name = "StepError";
  Object.defineProperties(stepError, {
    ...(input.originalError === undefined
      ? {}
      : {
          originalError: {
            value: input.originalError,
          },
        }),
    retryPolicy: {
      value: {
        maximumAttempts: 10,
      },
    },
    stepFailedAttempts: {
      value: 1,
    },
  });

  return stepError;
}

describe("trigger run failure resolution", () => {
  it("treats generic trigger execution failures wrapped by durable step errors as retryable", () => {
    const originalError = createTriggerRunExecutionError({
      code: TriggerRunFailureCodes.TRIGGER_RUN_EXECUTION_FAILED,
      message: "Sandbox startup failed before connection acquisition.",
      metadata: {
        "mistle.sandbox.instance_id": "sbi_retryable_startup_failure",
        "mistle.sandbox.failure_code": "sandbox_init_failed",
      },
    });
    const stepError = createDurableStepError({
      originalError,
    });

    expect(isTriggerRunExecutionFailure(stepError)).toBe(true);
    expect(isPermanentTriggerRunExecutionFailure(stepError)).toBe(false);
    expect(resolveTriggerRunFailure(stepError)).toEqual({
      code: TriggerRunFailureCodes.TRIGGER_RUN_EXECUTION_FAILED,
      message: "Sandbox startup failed before connection acquisition.",
      metadata: {
        "mistle.sandbox.instance_id": "sbi_retryable_startup_failure",
        "mistle.sandbox.failure_code": "sandbox_init_failed",
      },
    });
  });

  it("keeps ordinary durable step failures as generic trigger execution failures", () => {
    const stepError = createDurableStepError({
      message: "provider connection dropped",
    });

    expect(isTriggerRunExecutionFailure(stepError)).toBe(false);
    expect(isPermanentTriggerRunExecutionFailure(stepError)).toBe(false);
    expect(resolveTriggerRunFailure(stepError)).toEqual({
      code: TriggerRunFailureCodes.TRIGGER_RUN_EXECUTION_FAILED,
      message: "provider connection dropped",
      metadata: {},
    });
  });

  it("treats permanent trigger failures wrapped by durable step errors as terminal", () => {
    const stepError = createDurableStepError({
      originalError: {
        code: TriggerRunFailureCodes.TEMPLATE_RENDER_FAILED,
        message: "Rendered trigger input template must not be empty.",
      },
    });

    expect(isTriggerRunExecutionFailure(stepError)).toBe(true);
    expect(isPermanentTriggerRunExecutionFailure(stepError)).toBe(true);
    expect(resolveTriggerRunFailure(stepError)).toEqual({
      code: TriggerRunFailureCodes.TEMPLATE_RENDER_FAILED,
      message: "Rendered trigger input template must not be empty.",
      metadata: {},
    });
  });

  it("preserves serialized retry metadata from durable step errors", () => {
    const stepError = createDurableStepError({
      originalError: {
        code: TriggerRunFailureCodes.TRIGGER_RUN_EXECUTION_FAILED,
        message: "Sandbox bootstrap tunnel did not recover before disconnect grace expired.",
        metadata: {
          "mistle.sandbox.instance_id": "sbi_serialized_retry_metadata",
          "mistle.sandbox.status": "failed",
          "mistle.sandbox.failure_code": "sandbox_init_failed",
        },
      },
    });

    expect(isTriggerRunExecutionFailure(stepError)).toBe(true);
    expect(isPermanentTriggerRunExecutionFailure(stepError)).toBe(false);
    expect(resolveTriggerRunFailure(stepError)).toEqual({
      code: TriggerRunFailureCodes.TRIGGER_RUN_EXECUTION_FAILED,
      message: "Sandbox bootstrap tunnel did not recover before disconnect grace expired.",
      metadata: {
        "mistle.sandbox.instance_id": "sbi_serialized_retry_metadata",
        "mistle.sandbox.status": "failed",
        "mistle.sandbox.failure_code": "sandbox_init_failed",
      },
    });
  });

  it.each([
    {
      code: TriggerRunFailureCodes.SANDBOX_PROFILE_VERSION_NOT_FOUND,
      message: "Referenced sandbox profile version was deleted.",
    },
    {
      code: TriggerRunFailureCodes.SANDBOX_PROFILE_VERSION_NOT_USABLE,
      message: "Referenced sandbox profile version is not usable yet.",
    },
  ])("treats $code as a terminal configuration failure", ({ code, message }) => {
    const stepError = createDurableStepError({
      originalError: createTriggerRunExecutionError({
        code,
        message,
      }),
    });

    expect(isTriggerRunExecutionFailure(stepError)).toBe(true);
    expect(isPermanentTriggerRunExecutionFailure(stepError)).toBe(true);
    expect(resolveTriggerRunFailure(stepError)).toEqual({
      code,
      message,
      metadata: {},
    });
  });
});
