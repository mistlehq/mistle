/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended test `it` fixture imported from system test context.
 */

import { describe, expect } from "vitest";

import {
  connectCodexAgentSession,
  prepareCodexSandbox,
  readSandboxHealthz,
  runSandboxExecCommandInSandbox,
  triggerSandboxdEgressProxyKill,
  waitForCondition,
  waitForSandboxConnectable,
  waitForSandboxStatus,
} from "./helpers/codex-sandbox.js";
import { it } from "./system-test-context.js";

const SYSTEM_TEST_TIMEOUT_MS = 5 * 60_000;
const OPENAI_MODELS_URL = "https://api.openai.com/v1/models";
const OPENAI_API_KEY = "sk-system-sandbox-restart";
const SystemSandboxProvider = {
  DOCKER: "docker",
  E2B: "e2b",
} as const;
const requestedSystemSandboxProvider =
  process.env.MISTLE_TEST_SYSTEM_SANDBOX_PROVIDER ?? SystemSandboxProvider.DOCKER;
const itForDocker = requestedSystemSandboxProvider === SystemSandboxProvider.DOCKER ? it : it.skip;

function findComponentOrThrow(input: {
  response: Awaited<ReturnType<typeof readSandboxHealthz>>;
  component: string;
}): NonNullable<Awaited<ReturnType<typeof readSandboxHealthz>>["snapshot"]>["components"][number] {
  const snapshot = input.response.snapshot;
  if (snapshot === null) {
    throw new Error("Expected sandboxd __healthz snapshot to be present.");
  }

  const componentSnapshot = snapshot.components.find(
    (component) => component.component === input.component,
  );
  if (componentSnapshot === undefined) {
    throw new Error(`Expected sandboxd __healthz to include component '${input.component}'.`);
  }

  return componentSnapshot;
}

async function runOpenAiProxyProbe(input: {
  fixture: Parameters<typeof prepareCodexSandbox>[0]["fixture"];
  authenticatedSession: Awaited<ReturnType<typeof prepareCodexSandbox>>["authenticatedSession"];
  sandboxInstanceId: string;
}): Promise<Awaited<ReturnType<typeof runSandboxExecCommandInSandbox>>> {
  return runSandboxExecCommandInSandbox({
    fixture: input.fixture,
    authenticatedSession: input.authenticatedSession,
    sandboxInstanceId: input.sandboxInstanceId,
    command: "sh",
    args: [
      "-lc",
      [
        "curl",
        "-sS",
        "-o",
        "/dev/null",
        "-w",
        "'%{http_code}'",
        "-H",
        `'Authorization: Bearer ${OPENAI_API_KEY}'`,
        OPENAI_MODELS_URL,
      ].join(" "),
    ],
    timeoutMs: 30_000,
  });
}

describe("system sandboxd fault injection egress proxy recovery", () => {
  itForDocker(
    "recovers a real sandbox from a deterministic egress proxy fault",
    async ({ fixture }) => {
      const { authenticatedSession, sandboxInstanceId } = await prepareCodexSandbox({
        fixture,
        email: "sandboxd-fault-injection-egress-proxy-recovery@example.com",
      });
      const attachedAgentSession = await connectCodexAgentSession({
        fixture,
        authenticatedSession,
        sandboxInstanceId,
      });

      try {
        const initialProbe = await runOpenAiProxyProbe({
          fixture,
          authenticatedSession,
          sandboxInstanceId,
        });
        expect(initialProbe.exitCode).toBe(0);
        expect(initialProbe.stdout.trim()).not.toBe("000");

        const outageProbePromise = runSandboxExecCommandInSandbox({
          fixture,
          authenticatedSession,
          sandboxInstanceId,
          command: "sh",
          args: [
            "-lc",
            [
              "for _ in $(seq 1 400); do",
              `  if ! curl -sS -o /dev/null -H 'Authorization: Bearer ${OPENAI_API_KEY}' ${OPENAI_MODELS_URL}; then`,
              "    exit 17",
              "  fi",
              "  sleep 0.02",
              "done",
              "exit 99",
            ].join("\n"),
          ],
          timeoutMs: 60_000,
        });

        const faultResponse = await triggerSandboxdEgressProxyKill({
          fixture,
          authenticatedSession,
          sandboxInstanceId,
        });
        expect(faultResponse).toEqual({
          status: "accepted",
          component: "egress_proxy",
          action: "kill",
        });

        const outageProbe = await outageProbePromise;
        expect([17, 99]).toContain(outageProbe.exitCode);
        const trimmedOutageProbeStderr = outageProbe.stderr.trim();
        const sawOutage = outageProbe.exitCode === 17;
        expect(trimmedOutageProbeStderr.length > 0).toBe(sawOutage);

        const recoveredEgressProxy = await waitForCondition({
          description: "sandboxd egress proxy recovery",
          timeoutMs: 30_000,
          pollIntervalMs: 100,
          evaluate: async () => {
            const healthResponse = await readSandboxHealthz({
              fixture,
              authenticatedSession,
              sandboxInstanceId,
            });
            const egressProxy = findComponentOrThrow({
              response: healthResponse,
              component: "egress_proxy",
            });
            if (egressProxy.state === "healthy" && egressProxy.restart_count >= 1) {
              return egressProxy;
            }
            return null;
          },
        });
        expect(recoveredEgressProxy.restart_count).toBeGreaterThanOrEqual(1);

        const runningSandboxStatus = await waitForSandboxStatus({
          fixture,
          authenticatedSession,
          sandboxInstanceId,
          expectedStatus: "running",
        });
        expect(runningSandboxStatus.connectable).toBe(true);
        await waitForSandboxConnectable({
          fixture,
          authenticatedSession,
          sandboxInstanceId,
          expectedConnectable: true,
        });

        const recoveredProbe = await runOpenAiProxyProbe({
          fixture,
          authenticatedSession,
          sandboxInstanceId,
        });
        expect(recoveredProbe.exitCode).toBe(0);
        expect(recoveredProbe.stdout.trim()).not.toBe("000");
      } finally {
        await attachedAgentSession.close().catch(() => {});
      }
    },
    SYSTEM_TEST_TIMEOUT_MS,
  );
});
