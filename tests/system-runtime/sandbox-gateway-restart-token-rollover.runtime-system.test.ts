/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended Vitest fixture created by the system test harness.
 */

import { describe, expect } from "vitest";

import {
  prepareCodexSandbox,
  runSandboxPtyCommand,
  stopSandboxInstance,
  waitForSandboxConnectable,
} from "../system/helpers/codex-sandbox.js";
import { createRuntimeCodexSandboxFixture } from "./helpers/runtime-codex-sandbox.js";
import { createSandboxSystemTest } from "./helpers/sandbox-system-test.js";

const it = createSandboxSystemTest({
  extraInfra: ["mailpit"],
  sandboxProviders: ["e2b"],
  publicAccess: {
    provider: "cloudflare",
    services: ["data-plane-gateway", "tokenizer-proxy"],
  },
});

const SYSTEM_TEST_TIMEOUT_MS = 10 * 60_000;
const PtyRoundTripMarker = "MISTLE_GATEWAY_RESTART_READY";

describe("runtime system sandbox gateway restart token rollover", () => {
  it(
    "keeps a running sandbox reachable across two gateway restarts",
    async ({ system }) => {
      let currentStep = "start sandbox";
      let sandboxInstanceIdForCleanup: string | undefined;
      const fixture = createRuntimeCodexSandboxFixture(system);

      try {
        const { authenticatedSession, sandboxInstanceId } = await prepareCodexSandbox({
          fixture,
          email: "runtime-sandbox-gateway-restart-token-rollover@example.com",
        });
        sandboxInstanceIdForCleanup = sandboxInstanceId;

        currentStep = "verify PTY before restart";
        await assertSandboxPtyRoundTrip({
          fixture,
          authenticatedSession,
          sandboxInstanceId,
        });

        currentStep = "restart gateway first time";
        await system.dataPlaneGateway.restart();
        const sandboxStatusAfterFirstRestart = await waitForSandboxConnectable({
          fixture,
          authenticatedSession,
          sandboxInstanceId,
          expectedConnectable: true,
        });
        expect(sandboxStatusAfterFirstRestart.id).toBe(sandboxInstanceId);
        expect(sandboxStatusAfterFirstRestart.connectable).toBe(true);

        currentStep = "verify PTY after first restart";
        await assertSandboxPtyRoundTrip({
          fixture,
          authenticatedSession,
          sandboxInstanceId,
        });

        currentStep = "restart gateway second time";
        await system.dataPlaneGateway.restart();
        const sandboxStatusAfterSecondRestart = await waitForSandboxConnectable({
          fixture,
          authenticatedSession,
          sandboxInstanceId,
          expectedConnectable: true,
        });
        expect(sandboxStatusAfterSecondRestart.id).toBe(sandboxInstanceId);
        expect(sandboxStatusAfterSecondRestart.connectable).toBe(true);

        currentStep = "verify PTY after second restart";
        await assertSandboxPtyRoundTrip({
          fixture,
          authenticatedSession,
          sandboxInstanceId,
        });
      } catch (error) {
        throw new Error(
          `Gateway restart token rollover test failed during step '${currentStep}': ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      } finally {
        if (sandboxInstanceIdForCleanup !== undefined) {
          await stopSandboxInstance({
            fixture,
            sandboxInstanceId: sandboxInstanceIdForCleanup,
          });
        }
      }
    },
    SYSTEM_TEST_TIMEOUT_MS,
  );
});

async function assertSandboxPtyRoundTrip(input: {
  fixture: ReturnType<typeof createRuntimeCodexSandboxFixture>;
  authenticatedSession: Awaited<ReturnType<typeof prepareCodexSandbox>>["authenticatedSession"];
  sandboxInstanceId: string;
}): Promise<void> {
  const result = await runSandboxPtyCommand({
    fixture: input.fixture,
    authenticatedSession: input.authenticatedSession,
    sandboxInstanceId: input.sandboxInstanceId,
    command: "sh",
    args: ["-lc", `printf '%s\\n' ${PtyRoundTripMarker}; sleep 0.2`],
  });

  expect(result.exitCode).toBe(0);
  expect(result.output).toContain(PtyRoundTripMarker);
}
