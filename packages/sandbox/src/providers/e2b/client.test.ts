import type { Sleeper } from "@mistle/time";
import { createMutableClock } from "@mistle/time/testing";
import { describe, expect, it } from "vitest";

import { E2BClientError, E2BClientErrorCodes, E2BClientOperationIds } from "./client-errors.js";
import {
  createE2BDaemonCommandOptions,
  createE2BStartupCommandOptions,
  E2BStartRateLimiter,
  isE2BTemplateStartRefNotReadyError,
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

describe("createE2BDaemonCommandOptions", () => {
  it("passes sandbox runtime env to the sandboxd daemon command", () => {
    const options = createE2BDaemonCommandOptions({
      MISTLE_SANDBOXD_ENABLE_TEST_FAULTS: "1",
      SANDBOX_RUNTIME_SANDBOX_INSTANCE_ID: "sbi_test",
    });

    expect(options).toEqual({
      background: true,
      envs: {
        MISTLE_SANDBOXD_ENABLE_TEST_FAULTS: "1",
        SANDBOX_RUNTIME_LISTEN_ADDR: "127.0.0.1:8090",
        SANDBOX_RUNTIME_SANDBOX_INSTANCE_ID: "sbi_test",
      },
      timeoutMs: 0,
      user: "root",
    });
  });

  it("leaves daemon command env unspecified when no runtime env is provided", () => {
    const options = createE2BDaemonCommandOptions(undefined);

    expect(options).toEqual({
      background: true,
      timeoutMs: 0,
      user: "root",
    });
  });
});

describe("createE2BStartupCommandOptions", () => {
  it("disables E2B command timeout for sandboxd startup payload commands", () => {
    expect(createE2BStartupCommandOptions()).toEqual({
      background: true,
      stdin: true,
      timeoutMs: 0,
      user: "root",
    });
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

describe("isE2BTemplateStartRefNotReadyError", () => {
  it("recognizes E2B create errors where the resolved default template tag is not ready", () => {
    const source = new Error(
      "404: tag 'default' does not exist for template 'mistle/mistle-sandbox-base-abc123'",
    );

    expect(isE2BTemplateStartRefNotReadyError(source, "mistle-sandbox-base-abc123:default")).toBe(
      true,
    );
  });

  it("recognizes nested E2B default tag readiness errors", () => {
    const source = new Error(
      "404: tag 'default' does not exist for template 'mistle/mistle-sandbox-base-abc123'",
    );
    const wrapped = new Error("E2B operation `create_sandbox` failed", { cause: source });

    expect(isE2BTemplateStartRefNotReadyError(wrapped, "mistle-sandbox-base-abc123:default")).toBe(
      true,
    );
  });

  it("does not match unrelated template aliases", () => {
    const source = new Error(
      "404: tag 'default' does not exist for template 'mistle/mistle-sandbox-base-other'",
    );

    expect(isE2BTemplateStartRefNotReadyError(source, "mistle-sandbox-base-abc123:default")).toBe(
      false,
    );
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

  it("retries caller-classified E2B readiness failures with bounded backoff", async () => {
    const sleepDurations: number[] = [];
    let attempts = 0;

    const result = await runE2BOperationWithTransientRetries({
      operation: E2BClientOperationIds.CREATE_SANDBOX,
      maxAttempts: 4,
      retryDelayMs: 10,
      sleeper: {
        sleep: async (durationMs) => {
          sleepDurations.push(durationMs);
        },
      },
      shouldRetry: (error) =>
        isE2BTemplateStartRefNotReadyError(error, "mistle-sandbox-base-abc123:default"),
      run: async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new Error(
            "404: tag 'default' does not exist for template 'mistle/mistle-sandbox-base-abc123'",
          );
        }

        return "created";
      },
    });

    expect(result).toBe("created");
    expect(attempts).toBe(3);
    expect(sleepDurations).toEqual([10, 20]);
  });
});
