/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended Vitest fixture created by the system test harness.
 */

import { startCodexThread } from "@mistle/integrations-definitions/agent-runtimes/codex/server";
import { describe, expect } from "vitest";

import {
  connectCodexAgentSession,
  prepareCodexSandbox,
  resumeSandboxInstance,
  stopSandboxInstanceByUserRequest,
  waitForRuntimeReadyValue,
  waitForSandboxConnectable,
  waitForSandboxStatus,
} from "../system/helpers/codex-sandbox.js";
import { createRuntimeCodexSandboxFixture } from "./helpers/runtime-codex-sandbox.js";
import { createSandboxSystemTest } from "./helpers/sandbox-system-test.js";
import { timeSystemRuntimePhase } from "./helpers/system-runtime-phase-timing.js";

const it = createSandboxSystemTest({
  extraInfra: ["mailpit"],
  sandboxProviders: ["docker", "e2b"],
  publicAccess: {
    provider: "cloudflare",
    services: ["data-plane-gateway"],
  },
});

const SYSTEM_TEST_TIMEOUT_MS = 10 * 60_000;
const STOP_RUNTIME_READY_TIMEOUT_MS = 90_000;
const RESUME_PUBLIC_ACCESS_READY_TIMEOUT_MS = 30_000;
const RESUME_SANDBOX_STATUS_TIMEOUT_MS = 8 * 60_000;

describe("runtime system sandbox stop resume restores runtime readiness", () => {
  it(
    "waits for runtime-ready recovery across stop and resume",
    async ({ sandboxProvider, system }) => {
      const fixture = createRuntimeCodexSandboxFixture(system);
      const timingAttributes = { sandboxProvider };

      const { authenticatedSession, sandboxInstanceId } = await timeSystemRuntimePhase({
        event: "system_runtime.sandbox_stop_resume.phase_timing",
        phase: "prepare_sandbox",
        attributes: timingAttributes,
        operation: async () =>
          await prepareCodexSandbox({
            fixture,
            email: "runtime-sandbox-stop-resume-restores-runtime-readiness@example.com",
          }),
      });

      const initialRuntimeState = await timeSystemRuntimePhase({
        event: "system_runtime.sandbox_stop_resume.phase_timing",
        phase: "read_initial_runtime_state",
        attributes: timingAttributes,
        operation: async () => await fixture.readSandboxRuntimeState(sandboxInstanceId),
      });
      expect(initialRuntimeState.attachment).not.toBeNull();
      expect(initialRuntimeState.runtime.ready).toBe(true);

      await timeSystemRuntimePhase({
        event: "system_runtime.sandbox_stop_resume.phase_timing",
        phase: "stop_sandbox",
        attributes: timingAttributes,
        operation: async () =>
          await stopSandboxInstanceByUserRequest({
            fixture,
            authenticatedSession,
            sandboxInstanceId,
          }),
      });

      await timeSystemRuntimePhase({
        event: "system_runtime.sandbox_stop_resume.phase_timing",
        phase: "wait_sandbox_stopped",
        attributes: timingAttributes,
        operation: async () =>
          await waitForSandboxStatus({
            fixture,
            authenticatedSession,
            sandboxInstanceId,
            expectedStatus: "stopped",
          }),
      });
      await timeSystemRuntimePhase({
        event: "system_runtime.sandbox_stop_resume.phase_timing",
        phase: "wait_sandbox_not_connectable",
        attributes: timingAttributes,
        operation: async () =>
          await waitForSandboxConnectable({
            fixture,
            authenticatedSession,
            sandboxInstanceId,
            expectedConnectable: false,
          }),
      });
      await timeSystemRuntimePhase({
        event: "system_runtime.sandbox_stop_resume.phase_timing",
        phase: "wait_runtime_ready_false",
        attributes: timingAttributes,
        operation: async () =>
          await waitForRuntimeReadyValue({
            fixture,
            sandboxInstanceId,
            expectedReady: false,
            timeoutMs: STOP_RUNTIME_READY_TIMEOUT_MS,
          }),
      });

      const publicAccess = readPublicAccessOrThrow(system);
      await timeSystemRuntimePhase({
        event: "system_runtime.sandbox_stop_resume.phase_timing",
        phase: "check_public_access_ready_before_resume",
        attributes: timingAttributes,
        operation: async () =>
          await publicAccess.checkReady({
            timeoutMs: RESUME_PUBLIC_ACCESS_READY_TIMEOUT_MS,
          }),
      });

      await timeSystemRuntimePhase({
        event: "system_runtime.sandbox_stop_resume.phase_timing",
        phase: "resume_sandbox",
        attributes: timingAttributes,
        operation: async () =>
          await resumeSandboxInstance({
            fixture,
            authenticatedSession,
            sandboxInstanceId,
          }),
      });

      await timeSystemRuntimePhase({
        event: "system_runtime.sandbox_stop_resume.phase_timing",
        phase: "wait_sandbox_running_after_resume",
        attributes: timingAttributes,
        operation: async () =>
          await waitForSandboxStatusAfterResume({
            fixture,
            authenticatedSession,
            publicAccess,
            sandboxInstanceId,
            sandboxProvider,
          }),
      });
      const runtimeStateWhenRunning = await timeSystemRuntimePhase({
        event: "system_runtime.sandbox_stop_resume.phase_timing",
        phase: "read_runtime_state_after_resume",
        attributes: timingAttributes,
        operation: async () => await fixture.readSandboxRuntimeState(sandboxInstanceId),
      });
      expect(runtimeStateWhenRunning.runtime.ready).toBe(true);

      const resumedSandboxStatus = await timeSystemRuntimePhase({
        event: "system_runtime.sandbox_stop_resume.phase_timing",
        phase: "wait_sandbox_connectable_after_resume",
        attributes: timingAttributes,
        operation: async () =>
          await waitForSandboxConnectable({
            fixture,
            authenticatedSession,
            sandboxInstanceId,
            expectedConnectable: true,
          }),
      });
      expect(resumedSandboxStatus.status).toBe("running");

      const recoveredAgentSession = await timeSystemRuntimePhase({
        event: "system_runtime.sandbox_stop_resume.phase_timing",
        phase: "connect_agent_session_after_resume",
        attributes: timingAttributes,
        operation: async () =>
          await connectCodexAgentSession({
            fixture,
            authenticatedSession,
            sandboxInstanceId,
          }),
      });

      try {
        const startedThread = await timeSystemRuntimePhase({
          event: "system_runtime.sandbox_stop_resume.phase_timing",
          phase: "start_codex_thread_after_resume",
          attributes: timingAttributes,
          operation: async () =>
            await startCodexThread({
              rpcClient: recoveredAgentSession.rpcClient,
              model: "gpt-5.3-codex",
            }),
        });
        expect(startedThread.threadId).toMatch(/^019/u);
      } finally {
        await timeSystemRuntimePhase({
          event: "system_runtime.sandbox_stop_resume.phase_timing",
          phase: "close_agent_session_after_resume",
          attributes: timingAttributes,
          operation: async () => {
            await recoveredAgentSession.close().catch(() => {});
          },
        });
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
      timeoutMs: RESUME_SANDBOX_STATUS_TIMEOUT_MS,
    });
  } catch (error) {
    console.info(
      JSON.stringify({
        event: "sandbox_stop_resume.public_access_diagnostics_after_resume_wait_failure",
        sandboxInstanceId: input.sandboxInstanceId,
        sandboxProvider: input.sandboxProvider,
        resumeStatusTimeoutMs: RESUME_SANDBOX_STATUS_TIMEOUT_MS,
        publicAccessDiagnostics: await input.publicAccess.readDiagnostics(),
      }),
    );
    throw error;
  }
}
