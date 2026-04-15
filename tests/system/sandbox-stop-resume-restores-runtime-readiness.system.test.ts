/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended test `it` fixture imported from system test context.
 */

import { startCodexThread } from "@mistle/integrations-definitions/agent-runtimes/codex/server";
import { describe, expect } from "vitest";

import {
  connectCodexAgentSession,
  prepareCodexSandbox,
  resumeSandboxInstance,
  stopSandboxInstance,
  waitForSandboxConnectable,
  waitForSandboxStatus,
} from "./helpers/codex-sandbox.js";
import { it } from "./system-test-context.js";

const SYSTEM_TEST_TIMEOUT_MS = 5 * 60_000;

describe("system sandbox stop resume restores runtime readiness", () => {
  it(
    "waits for runtime-ready recovery across stop and resume",
    async ({ fixture }) => {
      const { authenticatedSession, sandboxInstanceId } = await prepareCodexSandbox({
        fixture,
        email: "sandbox-stop-resume-restores-runtime-readiness@example.com",
      });

      const initialRuntimeState = await fixture.readSandboxRuntimeState(sandboxInstanceId);
      expect(initialRuntimeState.attachment).not.toBeNull();
      expect(initialRuntimeState.runtime.ready).toBe(true);

      await stopSandboxInstance({
        fixture,
        sandboxInstanceId,
      });

      await waitForSandboxStatus({
        fixture,
        authenticatedSession,
        sandboxInstanceId,
        expectedStatus: "stopped",
      });
      await waitForSandboxConnectable({
        fixture,
        authenticatedSession,
        sandboxInstanceId,
        expectedConnectable: false,
      });
      const stoppedRuntimeState = await fixture.waitForSandboxRuntimeReady(
        sandboxInstanceId,
        false,
      );
      expect(stoppedRuntimeState.runtime.ready).toBe(false);

      await resumeSandboxInstance({
        fixture,
        authenticatedSession,
        sandboxInstanceId,
      });

      await waitForSandboxStatus({
        fixture,
        authenticatedSession,
        sandboxInstanceId,
        expectedStatus: "running",
      });
      const runtimeStateWhenRunning = await fixture.readSandboxRuntimeState(sandboxInstanceId);
      expect(runtimeStateWhenRunning.runtime.ready).toBe(true);

      const resumedSandboxStatus = await waitForSandboxConnectable({
        fixture,
        authenticatedSession,
        sandboxInstanceId,
        expectedConnectable: true,
      });
      expect(resumedSandboxStatus.status).toBe("running");

      const recoveredAgentSession = await connectCodexAgentSession({
        fixture,
        authenticatedSession,
        sandboxInstanceId,
      });

      try {
        const startedThread = await startCodexThread({
          rpcClient: recoveredAgentSession.rpcClient,
          model: "gpt-5.3-codex",
        });
        expect(startedThread.threadId).toMatch(/^019/);
      } finally {
        await recoveredAgentSession.close().catch(() => {});
      }
    },
    SYSTEM_TEST_TIMEOUT_MS,
  );
});
