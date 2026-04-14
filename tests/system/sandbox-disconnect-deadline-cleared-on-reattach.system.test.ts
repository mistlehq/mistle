/* eslint-disable jest/no-standalone-expect --
 * This suite uses the extended system test fixture with real cross-service flows.
 */

import { systemSleeper } from "@mistle/time";
import { describe, expect } from "vitest";

import { it } from "./system-test-context.js";

const TestTimeoutMs = 10 * 60_000;
const DisconnectDeadlineBufferMs = 3_000;

describe("sandbox disconnect deadline cleared on reattach", () => {
  it(
    "does not reconcile a sandbox that reattaches before disconnect grace expires",
    async ({ fixture }) => {
      let currentStep = "start sandbox";

      try {
        if (
          fixture.dataPlaneGatewayBootstrapDisconnectGraceMs + DisconnectDeadlineBufferMs >=
          fixture.dataPlaneGatewayIdleTimeoutMs
        ) {
          throw new Error(
            `Expected disconnect grace plus buffer to remain below idle timeout. disconnectGraceMs=${String(
              fixture.dataPlaneGatewayBootstrapDisconnectGraceMs,
            )} idleTimeoutMs=${String(fixture.dataPlaneGatewayIdleTimeoutMs)}`,
          );
        }

        const sandboxInstanceId = await fixture.startSandboxAndWaitReady();

        currentStep = "verify PTY before restart";
        await fixture.openPtyAndAssertRoundTrip(sandboxInstanceId);

        currentStep = "restart gateway and wait for reattach";
        await fixture.restartContainer(fixture.dataPlaneGatewayContainerId);
        const sandboxStatusAfterReconnect = await fixture.waitForSandboxConnectable(
          sandboxInstanceId,
          true,
        );
        expect(sandboxStatusAfterReconnect.id).toBe(sandboxInstanceId);
        expect(sandboxStatusAfterReconnect.connectable).toBe(true);

        currentStep = "verify PTY after reconnect";
        await fixture.openPtyAndAssertRoundTrip(sandboxInstanceId);

        currentStep = "wait past disconnect deadline";
        await systemSleeper.sleep(
          fixture.dataPlaneGatewayBootstrapDisconnectGraceMs + DisconnectDeadlineBufferMs,
        );

        currentStep = "assert sandbox still running after disconnect deadline";
        const sandboxStatusAfterDeadline = await fixture.waitForSandboxConnectable(
          sandboxInstanceId,
          true,
        );
        expect(sandboxStatusAfterDeadline.id).toBe(sandboxInstanceId);
        expect(sandboxStatusAfterDeadline.status).toBe("running");
        expect(sandboxStatusAfterDeadline.connectable).toBe(true);

        currentStep = "verify PTY after disconnect deadline";
        await fixture.openPtyAndAssertRoundTrip(sandboxInstanceId);
      } catch (error) {
        throw new Error(
          `Disconnect deadline cleared-on-reattach test failed during step '${currentStep}': ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    },
    TestTimeoutMs,
  );
});
