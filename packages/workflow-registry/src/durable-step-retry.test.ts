import { describe, expect, it } from "vitest";

import {
  rethrowDurableStepErrorForRetry,
  resolveDurableStepFinalError,
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

  it("keeps non-retryable original errors retryable by default while attempts remain", () => {
    const error = new Error("sandbox provider rejected the request");
    error.name = "StepError";
    Object.defineProperties(error, {
      originalError: {
        value: {
          retryable: false,
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

    expect(shouldRethrowDurableStepErrorForRetry(error)).toBe(true);
  });

  it("allows opted-in workflows to finalize non-retryable original errors", () => {
    const error = new Error("sandbox provider rejected the request");
    error.name = "StepError";
    Object.defineProperties(error, {
      originalError: {
        value: {
          retryable: false,
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

    expect(
      shouldRethrowDurableStepErrorForRetry(error, {
        finalizeNonRetryableOriginalError: true,
      }),
    ).toBe(false);
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

describe("resolveDurableStepFinalError", () => {
  it("keeps retryable durable step errors intact for retry handling", () => {
    const error = createDurableStepError({
      maximumAttempts: 3,
      stepFailedAttempts: 1,
    });

    expect(resolveDurableStepFinalError(error)).toBe(error);
  });

  it("keeps non-retryable original errors intact by default while attempts remain", () => {
    const providerError = new Error("sandbox provider rejected the request");
    Object.defineProperty(providerError, "retryable", {
      value: false,
    });
    const error = createDurableStepError({
      maximumAttempts: 3,
      originalError: providerError,
      stepFailedAttempts: 1,
    });

    expect(resolveDurableStepFinalError(error)).toBe(error);
  });

  it("unwraps opted-in non-retryable durable step errors to their original application error", () => {
    const providerError = new Error("sandbox provider rejected the request");
    Object.defineProperty(providerError, "retryable", {
      value: false,
    });
    const error = createDurableStepError({
      maximumAttempts: 3,
      originalError: providerError,
      stepFailedAttempts: 1,
    });

    expect(
      resolveDurableStepFinalError(error, {
        finalizeNonRetryableOriginalError: true,
      }),
    ).toBe(providerError);
  });

  it("converts finalized durable step errors without original errors into ordinary errors", () => {
    const error = createDurableStepError({
      maximumAttempts: 3,
      stepFailedAttempts: 3,
    });

    const finalError = resolveDurableStepFinalError(error);

    expect(finalError).toBeInstanceOf(Error);
    expect(finalError).not.toBe(error);
    expect(finalError).toMatchObject({
      message: "sandbox provider start timed out",
    });
  });
});

function createDurableStepError(input: {
  maximumAttempts: number;
  originalError?: Error;
  stepFailedAttempts: number;
}): Error {
  const error = new Error("sandbox provider start timed out");
  error.name = "StepError";
  Object.defineProperties(error, {
    ...(input.originalError === undefined
      ? {}
      : {
          originalError: {
            value: input.originalError,
          },
        }),
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
