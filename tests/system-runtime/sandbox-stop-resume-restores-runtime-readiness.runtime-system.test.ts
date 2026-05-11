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
    services: ["data-plane-gateway"],
  },
});

const SYSTEM_TEST_TIMEOUT_MS = 5 * 60_000;
const STOP_RUNTIME_READY_TIMEOUT_MS = 90_000;
const RESUME_PUBLIC_ACCESS_READY_TIMEOUT_MS = 30_000;

describe("runtime system sandbox stop resume restores runtime readiness", () => {
  it(
    "waits for runtime-ready recovery across stop and resume",
    async ({ sandboxProvider, system }) => {
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

      const publicAccess = readPublicAccessOrThrow(system);
      await publicAccess.checkReady({
        timeoutMs: RESUME_PUBLIC_ACCESS_READY_TIMEOUT_MS,
      });

      await resumeSandboxInstance({
        fixture,
        authenticatedSession,
        sandboxInstanceId,
      });

      await waitForSandboxStatusAfterResume({
        fixture,
        authenticatedSession,
        publicAccess,
        sandboxInstanceId,
        sandboxProvider,
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

function readPublicAccessOrThrow(system: Parameters<typeof createRuntimeCodexSandboxFixture>[0]) {
  const { publicAccess } = system;
  if (publicAccess === undefined) {
    throw new Error("Stop/resume runtime system test requires public access diagnostics.");
  }
  return publicAccess;
}

async function waitForSandboxStatusAfterResume(input: {
  fixture: Parameters<typeof waitForSandboxStatus>[0]["fixture"];
  authenticatedSession: Parameters<typeof waitForSandboxStatus>[0]["authenticatedSession"];
  publicAccess: ReturnType<typeof readPublicAccessOrThrow>;
  sandboxInstanceId: string;
  sandboxProvider: string;
}): Promise<void> {
  try {
    await waitForSandboxStatus({
      fixture: input.fixture,
      authenticatedSession: input.authenticatedSession,
      sandboxInstanceId: input.sandboxInstanceId,
      expectedStatus: "running",
    });
  } catch (error) {
    console.info(
      JSON.stringify({
        event: "sandbox_stop_resume.public_access_diagnostics_after_resume_wait_failure",
        sandboxInstanceId: input.sandboxInstanceId,
        sandboxProvider: input.sandboxProvider,
        publicAccessDiagnostics: await input.publicAccess.readDiagnostics(),
      }),
    );
    throw error;
  }
}
