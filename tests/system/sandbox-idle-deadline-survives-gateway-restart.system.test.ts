/* eslint-disable jest/no-standalone-expect --
 * This suite uses the extended system test fixture with real cross-service flows.
 */

import { describe, expect } from "vitest";

import { it } from "./system-test-context.js";

const TestTimeoutMs = 10 * 60_000;

describe("sandbox idle deadline survives gateway restart", () => {
  it(
    "stops an idle sandbox even if the gateway restarts during the idle window",
    async ({ fixture }) => {
      let currentStep = "start sandbox";

      try {
        const sandboxInstanceId = await fixture.startSandboxAndWaitReady();

        currentStep = "verify PTY before restart";
        await fixture.openPtyAndAssertRoundTrip(sandboxInstanceId);

        currentStep = "assert sandbox is idle-eligible before restart";
        const runtimeStateBeforeRestart = await fixture.readSandboxRuntimeState(sandboxInstanceId);
        expect(runtimeStateBeforeRestart.presence.activeCount).toBe(0);
        expect(runtimeStateBeforeRestart.keepalive.active).toBe(false);

        currentStep = "restart gateway during idle window";
        await fixture.restartContainer(fixture.dataPlaneGatewayContainerId);

        currentStep = "wait for idle stop";
        const stoppedSandboxStatus = await fixture.waitForSandboxStatus(
          sandboxInstanceId,
          "stopped",
        );
        expect(stoppedSandboxStatus.id).toBe(sandboxInstanceId);
        expect(stoppedSandboxStatus.status).toBe("stopped");
        expect(stoppedSandboxStatus.connectable).toBe(false);
      } catch (error) {
        throw new Error(
          `Idle deadline survives gateway restart test failed during step '${currentStep}': ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    },
    TestTimeoutMs,
  );
});
