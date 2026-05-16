import { describe, expect, it } from "vitest";

import {
  rethrowDurableStepErrorForRetry,
  shouldRethrowDurableStepErrorForRetry,
} from "./durable-step-retry.js";

describe("shouldRethrowDurableStepErrorForRetry", () => {
  it("keeps durable step retries active while attempts remain", () => {
    const error = new Error("sandbox provider start timed out");
    error.name = "StepError";
    Object.defineProperties(error, {
      retryPolicy: {
        value: {
          maximumAttempts: 10,
        },
      },
      stepFailedAttempts: {
        value: 1,
      },
    });

    expect(shouldRethrowDurableStepErrorForRetry(error)).toBe(true);
  });

  it("allows exhausted durable step failures to be finalized by the workflow", () => {
    const error = new Error("sandbox provider start timed out");
    error.name = "StepError";
    Object.defineProperties(error, {
      retryPolicy: {
        value: {
          maximumAttempts: 10,
        },
      },
      stepFailedAttempts: {
        value: 10,
      },
    });

    expect(shouldRethrowDurableStepErrorForRetry(error)).toBe(false);
  });

  it("does not treat ordinary application errors as durable retry signals", () => {
    expect(shouldRethrowDurableStepErrorForRetry(new Error("sandbox startup failed"))).toBe(false);
  });
});

describe("rethrowDurableStepErrorForRetry", () => {
  it("rethrows retryable durable step errors", () => {
    const error = createDurableStepError({
      maximumAttempts: 3,
      stepFailedAttempts: 1,
    });

    expect(() => rethrowDurableStepErrorForRetry(error)).toThrow(error);
  });

  it("leaves exhausted durable step errors for workflow failure handling", () => {
    const error = createDurableStepError({
      maximumAttempts: 3,
      stepFailedAttempts: 3,
    });

    expect(() => rethrowDurableStepErrorForRetry(error)).not.toThrow();
  });
});

function createDurableStepError(input: {
  maximumAttempts: number;
  stepFailedAttempts: number;
}): Error {
  const error = new Error("sandbox provider start timed out");
  error.name = "StepError";
  Object.defineProperties(error, {
    retryPolicy: {
      value: {
        maximumAttempts: input.maximumAttempts,
      },
    },
    stepFailedAttempts: {
      value: input.stepFailedAttempts,
    },
  });
  return error;
}
