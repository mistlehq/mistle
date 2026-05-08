import { describe, expect, it } from "vitest";

import { shouldRethrowDurableStepErrorForRetry } from "./durable-step-retry.js";

describe("shouldRethrowDurableStepErrorForRetry", () => {
  it("keeps durable step retries active while attempts remain", () => {
    const error = new Error("credential resolution timed out");
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
    const error = new Error("credential resolution timed out");
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
    expect(shouldRethrowDurableStepErrorForRetry(new Error("delivery failed"))).toBe(false);
  });
});
