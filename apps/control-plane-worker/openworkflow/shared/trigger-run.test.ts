import { describe, expect, it } from "vitest";

import {
  TriggerRunFailureCodes,
  createTriggerRunExecutionError,
  isPermanentTriggerRunExecutionFailure,
  isTriggerRunExecutionFailure,
  resolveTriggerRunFailure,
} from "./trigger-run.js";

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
    expect(isPermanentTriggerRunExecutionFailure(stepError)).toBe(false);
    expect(resolveTriggerRunFailure(stepError)).toEqual({
      code: TriggerRunFailureCodes.TRIGGER_RUN_EXECUTION_FAILED,
      message: "provider connection dropped",
      metadata: {},
    });
  });

  it("treats permanent trigger failures wrapped by durable step errors as terminal", () => {
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
    expect(isPermanentTriggerRunExecutionFailure(stepError)).toBe(true);
    expect(resolveTriggerRunFailure(stepError)).toEqual({
      code: TriggerRunFailureCodes.TEMPLATE_RENDER_FAILED,
      message: "Rendered trigger input template must not be empty.",
      metadata: {},
    });
  });

  it("preserves serialized retry metadata from durable step errors", () => {
    const stepError = new Error("durable step failed");
    stepError.name = "StepError";
    Object.defineProperties(stepError, {
      originalError: {
        value: {
          code: TriggerRunFailureCodes.TRIGGER_RUN_EXECUTION_FAILED,
          message: "Sandbox bootstrap tunnel did not recover before disconnect grace expired.",
          metadata: {
            "mistle.sandbox.instance_id": "sbi_serialized_retry_metadata",
            "mistle.sandbox.status": "failed",
            "mistle.sandbox.failure_code": "sandbox_init_failed",
          },
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
});
