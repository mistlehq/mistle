/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended Vitest fixture created by the system test harness.
 */

import { describe, expect } from "vitest";

import {
  connectCodexAgentSession,
  killRawCodexAppServer,
  prepareCodexSandbox,
  waitForCondition,
  waitForRuntimeReadyValue,
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

const SYSTEM_TEST_TIMEOUT_MS = 5 * 60_000;

describe("runtime system sandbox runtime.ready follows codex recovery", () => {
  it(
    "projects runtime.ready from supervised Codex health",
    async ({ sandboxProvider, system }) => {
      const fixture = createRuntimeCodexSandboxFixture(system);
      const timingAttributes = { sandboxProvider };

      const { authenticatedSession, sandboxInstanceId } = await timeSystemRuntimePhase({
        event: "system_runtime.sandbox_runtime_ready_recovery.phase_timing",
        phase: "prepare_sandbox",
        attributes: timingAttributes,
        operation: async () =>
          await prepareCodexSandbox({
            fixture,
            email: "runtime-sandbox-ready-follows-codex-recovery@example.com",
          }),
      });
      const attachedAgentSession = await timeSystemRuntimePhase({
        event: "system_runtime.sandbox_runtime_ready_recovery.phase_timing",
        phase: "connect_agent_session",
        attributes: timingAttributes,
        operation: async () =>
          await connectCodexAgentSession({
            fixture,
            authenticatedSession,
            sandboxInstanceId,
          }),
      });

      try {
        const initialRuntimeState = await timeSystemRuntimePhase({
          event: "system_runtime.sandbox_runtime_ready_recovery.phase_timing",
          phase: "read_initial_runtime_state",
          attributes: timingAttributes,
          operation: async () => await fixture.readSandboxRuntimeState(sandboxInstanceId),
        });
        expect(initialRuntimeState.attachment).not.toBeNull();
        expect(initialRuntimeState.runtime.ready).toBe(true);

        await timeSystemRuntimePhase({
          event: "system_runtime.sandbox_runtime_ready_recovery.phase_timing",
          phase: "kill_codex_app_server",
          attributes: timingAttributes,
          operation: async () =>
            await killRawCodexAppServer({
              fixture,
              authenticatedSession,
              sandboxInstanceId,
            }),
        });

        const degradedRuntimeState = await timeSystemRuntimePhase({
          event: "system_runtime.sandbox_runtime_ready_recovery.phase_timing",
          phase: "wait_runtime_ready_false",
          attributes: timingAttributes,
          operation: async () =>
            await waitForCondition({
              description: `sandbox '${sandboxInstanceId}' runtime.ready=false with active attachment`,
              timeoutMs: 30_000,
              pollIntervalMs: 100,
              evaluate: async () => {
                const snapshot = await fixture.readSandboxRuntimeState(sandboxInstanceId);
                if (!snapshot.runtime.ready && snapshot.attachment !== null) {
                  return snapshot;
                }

                return null;
              },
            }),
        });
        expect(degradedRuntimeState.attachment).not.toBeNull();
        expect(degradedRuntimeState.runtime.ready).toBe(false);

        await timeSystemRuntimePhase({
          event: "system_runtime.sandbox_runtime_ready_recovery.phase_timing",
          phase: "wait_runtime_ready_recovered",
          attributes: timingAttributes,
          operation: async () =>
            await waitForRuntimeReadyValue({
              fixture,
              sandboxInstanceId,
              expectedReady: true,
              timeoutMs: 30_000,
            }),
        });

        const recoveredRuntimeState = await timeSystemRuntimePhase({
          event: "system_runtime.sandbox_runtime_ready_recovery.phase_timing",
          phase: "read_recovered_runtime_state",
          attributes: timingAttributes,
          operation: async () => await fixture.readSandboxRuntimeState(sandboxInstanceId),
        });
        expect(recoveredRuntimeState.runtime.ready).toBe(true);
      } finally {
        await timeSystemRuntimePhase({
          event: "system_runtime.sandbox_runtime_ready_recovery.phase_timing",
          phase: "close_agent_session",
          attributes: timingAttributes,
          operation: async () => {
            await attachedAgentSession.close().catch(() => {});
          },
        });
      }
    },
    SYSTEM_TEST_TIMEOUT_MS,
  );
});
