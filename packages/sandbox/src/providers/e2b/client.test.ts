import type { Sleeper } from "@mistle/time";
import { createMutableClock } from "@mistle/time/testing";
import { describe, expect, it } from "vitest";

import { E2BClientError, E2BClientErrorCodes, E2BClientOperationIds } from "./client-errors.js";
import {
  E2BStartRateLimiter,
  isTransientE2BSourceError,
  runE2BOperationWithTransientRetries,
} from "./client.js";

function createAdvancingSleeper(input: { advanceMs: (durationMs: number) => void }): Sleeper {
  return {
    sleep: async (durationMs) => {
      input.advanceMs(durationMs);
    },
  };
}

describe("E2BStartRateLimiter", () => {
  it("paces consecutive sandbox starts by the configured interval", async () => {
    const clock = createMutableClock(1_000);
    const limiter = new E2BStartRateLimiter({
      clock,
      minIntervalMs: 1_000,
      sleeper: createAdvancingSleeper({
        advanceMs: clock.advanceMs,
      }),
    });

    await limiter.waitForTurn();
    const firstStartMs = clock.nowMs();

    await limiter.waitForTurn();
    const secondStartMs = clock.nowMs();

    await limiter.waitForTurn();
    const thirdStartMs = clock.nowMs();

    expect(secondStartMs - firstStartMs).toBe(1_000);
    expect(thirdStartMs - secondStartMs).toBe(1_000);
  });
});

describe("isTransientE2BSourceError", () => {
  it("recognizes nested transport errors from the E2B SDK", () => {
    const source = new Error("fetch failed");
    const wrapped = new Error("E2B SDK request failed", { cause: source });

    expect(isTransientE2BSourceError(wrapped)).toBe(true);
  });

  it("does not classify mapped client errors as transient", () => {
    const error = new E2BClientError({
      code: E2BClientErrorCodes.NOT_FOUND,
      operation: E2BClientOperationIds.GET_SANDBOX_INFO,
      retryable: false,
      message: "sandbox was not found",
      cause: new Error("sandbox was not found"),
    });

    expect(isTransientE2BSourceError(error)).toBe(false);
  });
});

describe("runE2BOperationWithTransientRetries", () => {
  it("retries transient E2B transport failures with bounded backoff", async () => {
    const sleepDurations: number[] = [];
    let attempts = 0;

    const result = await runE2BOperationWithTransientRetries({
      operation: E2BClientOperationIds.CREATE_SANDBOX,
      maxAttempts: 3,
      retryDelayMs: 25,
      sleeper: {
        sleep: async (durationMs) => {
          sleepDurations.push(durationMs);
        },
      },
      run: async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new Error("fetch failed");
        }

        return "created";
      },
    });

    expect(result).toBe("created");
    expect(attempts).toBe(3);
    expect(sleepDurations).toEqual([25, 50]);
  });
});
