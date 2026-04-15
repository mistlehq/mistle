/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended test `it` fixture imported from system test context.
 */

import { describe, expect } from "vitest";

import {
  connectCodexAgentSession,
  killRawCodexAppServer,
  prepareCodexSandbox,
  waitForCondition,
  waitForRuntimeReadyValue,
} from "./helpers/codex-sandbox.js";
import { it } from "./system-test-context.js";

const SYSTEM_TEST_TIMEOUT_MS = 5 * 60_000;

describe("system sandbox runtime.ready follows codex recovery", () => {
  it(
    "projects runtime.ready from supervised Codex health rather than attachment alone",
    async ({ fixture }) => {
      const { authenticatedSession, sandboxInstanceId } = await prepareCodexSandbox({
        fixture,
        email: "sandbox-runtime-ready-follows-codex-recovery@example.com",
      });
      const attachedAgentSession = await connectCodexAgentSession({
        fixture,
        authenticatedSession,
        sandboxInstanceId,
      });

      try {
        const initialRuntimeState = await fixture.readSandboxRuntimeState(sandboxInstanceId);
        expect(initialRuntimeState.attachment).not.toBeNull();
        expect(initialRuntimeState.runtime.ready).toBe(true);

        await killRawCodexAppServer({
          fixture,
          authenticatedSession,
          sandboxInstanceId,
        });

        const degradedRuntimeState = await waitForCondition({
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
        });
        expect(degradedRuntimeState.attachment).not.toBeNull();
        expect(degradedRuntimeState.runtime.ready).toBe(false);

        await waitForRuntimeReadyValue({
          fixture,
          sandboxInstanceId,
          expectedReady: true,
          timeoutMs: 30_000,
        });

        const recoveredRuntimeState = await fixture.readSandboxRuntimeState(sandboxInstanceId);
        expect(recoveredRuntimeState.runtime.ready).toBe(true);
      } finally {
        await attachedAgentSession.close().catch(() => {});
      }
    },
    SYSTEM_TEST_TIMEOUT_MS,
  );
});
