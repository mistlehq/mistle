/* eslint-disable jest/no-standalone-expect --
 * This suite uses the extended system test fixture with real cross-service flows.
 */

import { describe, expect } from "vitest";

import { it } from "./system-test-context.js";

const TestTimeoutMs = 10 * 60_000;

describe("sandbox gateway restart token rollover", () => {
  it(
    "keeps a running sandbox reachable across two gateway restarts",
    async ({ fixture }) => {
      let currentStep = "start sandbox";

      try {
        const sandboxInstanceId = await fixture.startSandboxAndWaitReady();

        currentStep = "verify PTY before restart";
        await fixture.openPtyAndAssertRoundTrip(sandboxInstanceId);

        currentStep = "restart gateway first time";
        await fixture.restartContainer(fixture.dataPlaneGatewayContainerId);
        const sandboxStatusAfterFirstRestart = await fixture.waitForSandboxConnectable(
          sandboxInstanceId,
          true,
        );
        expect(sandboxStatusAfterFirstRestart.id).toBe(sandboxInstanceId);
        expect(sandboxStatusAfterFirstRestart.connectable).toBe(true);

        currentStep = "verify PTY after first restart";
        await fixture.openPtyAndAssertRoundTrip(sandboxInstanceId);

        currentStep = "restart gateway second time";
        await fixture.restartContainer(fixture.dataPlaneGatewayContainerId);
        const sandboxStatusAfterSecondRestart = await fixture.waitForSandboxConnectable(
          sandboxInstanceId,
          true,
        );
        expect(sandboxStatusAfterSecondRestart.id).toBe(sandboxInstanceId);
        expect(sandboxStatusAfterSecondRestart.connectable).toBe(true);

        currentStep = "verify PTY after second restart";
        await fixture.openPtyAndAssertRoundTrip(sandboxInstanceId);
      } catch (error) {
        throw new Error(
          `Gateway restart token rollover test failed during step '${currentStep}': ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    },
    TestTimeoutMs,
  );
});
