/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended Vitest fixture created by the system test harness.
 */

import { startCodexThread } from "@mistle/integrations-definitions/agent-runtimes/codex/server";
import { describe, expect } from "vitest";

import {
  connectCodexAgentSession,
  prepareCodexSandbox,
  resumeSandboxInstance,
  stopSandboxInstance,
  waitForRuntimeReadyValue,
  waitForSandboxConnectable,
  waitForSandboxStatus,
} from "../system/helpers/codex-sandbox.js";
import { createRuntimeCodexSandboxFixture } from "./helpers/runtime-codex-sandbox.js";
import { createSandboxSystemTest } from "./helpers/sandbox-system-test.js";

const it = createSandboxSystemTest({
  extraInfra: ["mailpit"],
  sandboxProviders: ["docker", "e2b"],
  publicAccess: {
    provider: "cloudflare",
    services: ["data-plane-gateway", "tokenizer-proxy"],
  },
});

const SYSTEM_TEST_TIMEOUT_MS = 5 * 60_000;
const STOP_RUNTIME_READY_TIMEOUT_MS = 90_000;

describe("runtime system sandbox stop resume restores runtime readiness", () => {
  it(
    "waits for runtime-ready recovery across stop and resume",
    async ({ system }) => {
      const fixture = createRuntimeCodexSandboxFixture(system);
      const { authenticatedSession, sandboxInstanceId } = await prepareCodexSandbox({
        fixture,
        email: "runtime-sandbox-stop-resume-restores-runtime-readiness@example.com",
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
      await waitForRuntimeReadyValue({
        fixture,
        sandboxInstanceId,
        expectedReady: false,
        timeoutMs: STOP_RUNTIME_READY_TIMEOUT_MS,
      });

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
        expect(startedThread.threadId).toMatch(/^019/u);
      } finally {
        await recoveredAgentSession.close().catch(() => {});
      }
    },
    SYSTEM_TEST_TIMEOUT_MS,
  );
});
