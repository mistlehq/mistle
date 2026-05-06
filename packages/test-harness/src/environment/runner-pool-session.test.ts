import { describe, expect, it } from "vitest";

import {
  ensureRunnerPoolSession,
  MISTLE_TEST_POOLING_ENV,
  MISTLE_TEST_RUN_ID_ENV,
  MISTLE_TEST_RUN_OWNER_PID_ENV,
} from "./runner-pool-session.js";

describe("ensureRunnerPoolSession", () => {
  it("preserves the outer runner owner pid when called inside worker processes", () => {
    const environment: NodeJS.ProcessEnv = {
      [MISTLE_TEST_RUN_ID_ENV]: "integration_run",
      [MISTLE_TEST_RUN_OWNER_PID_ENV]: "12345",
    };

    const session = ensureRunnerPoolSession(environment);

    expect(session.runId).toBe("integration_run");
    expect(session.ownerPid).toBe(12345);
    expect(environment[MISTLE_TEST_RUN_OWNER_PID_ENV]).toBe("12345");
    expect(environment[MISTLE_TEST_POOLING_ENV]).toBe("1");
  });

  it("sets the owner pid when a standalone process creates the runner session", () => {
    const environment: NodeJS.ProcessEnv = {
      [MISTLE_TEST_RUN_ID_ENV]: "standalone_run",
    };

    const session = ensureRunnerPoolSession(environment);

    expect(session.ownerPid).toBe(process.pid);
    expect(environment[MISTLE_TEST_RUN_OWNER_PID_ENV]).toBe(String(process.pid));
    expect(environment[MISTLE_TEST_POOLING_ENV]).toBe("1");
  });
});
