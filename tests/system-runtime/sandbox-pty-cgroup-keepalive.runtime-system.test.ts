/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended Vitest fixture created by the system test harness.
 */

import { randomUUID } from "node:crypto";

import { systemSleeper } from "@mistle/time";
import { describe, expect } from "vitest";

import { PtyStreamClient } from "../../packages/sandbox-session-client/src/pty-stream-client.js";
import { SandboxSessionTransport } from "../../packages/sandbox-session-client/src/transport.js";
import type {
  CodexSandboxAuthenticatedSession,
  CodexSandboxFixture,
} from "../system/helpers/codex-sandbox.js";
import {
  mintSandboxConnectionUrl,
  prepareCodexSandbox,
  runSandboxExecCommandInSandbox,
  waitForCondition,
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

const SYSTEM_TEST_TIMEOUT_MS = 12 * 60_000;
const PROCESS_LIFETIME_SECONDS = 45;
const PTY_COMMAND_TIMEOUT_MS = 60_000;
const RUNTIME_STATE_TIMEOUT_MS = 90_000;
const OUTPUT_POLL_INTERVAL_MS = 100;
const TERMINAL_CONTROL_SEQUENCE_PATTERN = new RegExp(
  String.raw`\u001B(?:\][^\u0007\u001B]*(?:\u0007|\u001B\\)|\[[0-?]*[ -/]*[@-~]|[@-_])`,
  "g",
);

type PersistentPtySession = {
  close: () => Promise<void>;
  waitForOutputMatch: (input: { pattern: RegExp; timeoutMs: number }) => Promise<RegExpMatchArray>;
  write: (payload: string) => Promise<void>;
};

describe("runtime system sandbox PTY cgroup keepalive", () => {
  it(
    "keeps the sandbox alive for a detached PTY child after the PTY stream closes",
    async ({ sandboxProvider, system }) => {
      const fixture = createRuntimeCodexSandboxFixture(system);
      let authenticatedSession: CodexSandboxAuthenticatedSession | undefined;
      let currentStep = "prepare sandbox";
      let detachedPid: string | undefined;
      let detachedProcessCgroupProbe: { exitCode: number; output: string } | undefined;
      let persistentPty: PersistentPtySession | undefined;
      let sandboxInstanceId: string | undefined;

      try {
        const preparedSandbox = await prepareCodexSandbox({
          fixture,
          email: `runtime-sandbox-pty-cgroup-keepalive-${sandboxProvider}@example.com`,
        });
        const session = preparedSandbox.authenticatedSession;
        const runningSandboxInstanceId = preparedSandbox.sandboxInstanceId;
        authenticatedSession = session;
        sandboxInstanceId = runningSandboxInstanceId;

        const marker = randomUUID();
        const markerDirectory = "/tmp/mistle-system-tests/pty-cgroup-keepalive";
        const pidFilePath = `${markerDirectory}/${marker}.pid`;
        const launchCommand = [
          `mkdir -p ${shellQuote(markerDirectory)}`,
          `rm -f ${shellQuote(pidFilePath)}`,
          `nohup sh -c 'echo $$ > ${pidFilePath}; sleep ${String(PROCESS_LIFETIME_SECONDS)}' >/dev/null 2>&1 < /dev/null & while [ ! -s ${shellQuote(pidFilePath)} ]; do sleep 0.1; done`,
          `printf 'DETACHED_PID:%s\\n' "$(cat ${shellQuote(pidFilePath)})"`,
          "cat",
        ].join("; ");

        currentStep = "open persistent PTY";
        persistentPty = await openPersistentPtySession({
          fixture,
          authenticatedSession: session,
          sandboxInstanceId: runningSandboxInstanceId,
          cwd: "/root",
        });

        currentStep = "launch detached PTY child";
        await persistentPty.write(`${launchCommand}\n`);
        const pidMatch = await persistentPty.waitForOutputMatch({
          timeoutMs: PTY_COMMAND_TIMEOUT_MS,
          pattern: /DETACHED_PID:(\d+)/,
        });
        detachedPid = pidMatch[1];
        if (detachedPid === undefined) {
          throw new Error("Expected detached PID capture from PTY output.");
        }
        expect(detachedPid).toMatch(/^[0-9]+$/u);

        currentStep = "close PTY stream";
        await persistentPty.close();
        persistentPty = undefined;

        currentStep = "assert sandbox remains running and connectable";
        await waitForSandboxStatus({
          fixture,
          authenticatedSession: session,
          sandboxInstanceId: runningSandboxInstanceId,
          expectedStatus: "running",
        });
        const sandboxStatus = await waitForSandboxConnectable({
          fixture,
          authenticatedSession: session,
          sandboxInstanceId: runningSandboxInstanceId,
          expectedConnectable: true,
        });
        expect(sandboxStatus.status).toBe("running");

        currentStep = "probe detached process from a fresh exec session";
        const aliveProbe = await runSandboxExecCommandInSandbox({
          fixture,
          authenticatedSession: session,
          sandboxInstanceId: runningSandboxInstanceId,
          command: "sh",
          args: ["-c", `kill -0 ${detachedPid} >/dev/null 2>&1 && printf '%s\\n' alive`],
        });
        expect(aliveProbe.exitCode).toBe(0);
        expect(aliveProbe.stdout.trim()).toBe("alive");

        currentStep = "capture detached process cgroup diagnostics";
        detachedProcessCgroupProbe = await captureDetachedProcessCgroupDiagnostics({
          fixture,
          authenticatedSession: session,
          sandboxInstanceId: runningSandboxInstanceId,
          detachedPid,
        });

        currentStep = "wait for runtime keepalive after PTY close";
        const runtimeStateWithDetachedProcess = await waitForCondition({
          description: "detached process keepalive after PTY close",
          timeoutMs: RUNTIME_STATE_TIMEOUT_MS,
          pollIntervalMs: 500,
          evaluate: async () => {
            const runtimeState = await fixture.readSandboxRuntimeState(runningSandboxInstanceId);
            if (runtimeState.presence.activeCount !== 0) {
              return null;
            }

            return runtimeState.keepalive.active ? runtimeState : null;
          },
        });
        expect(runtimeStateWithDetachedProcess.runtime.ready).toBe(true);
        expect(runtimeStateWithDetachedProcess.presence.activeCount).toBe(0);
        expect(runtimeStateWithDetachedProcess.keepalive.active).toBe(true);

        currentStep = "terminate detached process";
        const terminateResult = await runSandboxExecCommandInSandbox({
          fixture,
          authenticatedSession: session,
          sandboxInstanceId: runningSandboxInstanceId,
          command: "sh",
          args: ["-c", `kill ${detachedPid}`],
        });
        expect(terminateResult.exitCode).toBe(0);

        currentStep = "wait for detached process to disappear";
        await waitForCondition({
          description: `detached process ${detachedPid} to exit`,
          timeoutMs: RUNTIME_STATE_TIMEOUT_MS,
          pollIntervalMs: 500,
          evaluate: async () => {
            const probe = await runSandboxExecCommandInSandbox({
              fixture,
              authenticatedSession: session,
              sandboxInstanceId: runningSandboxInstanceId,
              command: "sh",
              args: [
                "-c",
                `kill -0 ${detachedPid} >/dev/null 2>&1 && printf '%s\\n' alive || printf '%s\\n' dead`,
              ],
            });

            return probe.exitCode === 0 && probe.stdout.trim() === "dead" ? probe : null;
          },
        });

        currentStep = "wait for keepalive to clear after detached process exit";
        const runtimeStateAfterExit = await waitForCondition({
          description: "keepalive to clear after detached process exit",
          timeoutMs: RUNTIME_STATE_TIMEOUT_MS,
          pollIntervalMs: 500,
          evaluate: async () => {
            const runtimeState = await fixture.readSandboxRuntimeState(runningSandboxInstanceId);
            if (runtimeState.presence.activeCount !== 0) {
              return null;
            }

            return runtimeState.keepalive.active ? null : runtimeState;
          },
        });
        expect(runtimeStateAfterExit.runtime.ready).toBe(true);
        expect(runtimeStateAfterExit.presence.activeCount).toBe(0);
        expect(runtimeStateAfterExit.keepalive.active).toBe(false);
      } catch (error) {
        const diagnostics = await collectFailureDiagnostics({
          fixture,
          authenticatedSession,
          sandboxInstanceId,
          detachedPid,
          detachedProcessCgroupProbe,
        });
        throw new Error(
          `PTY cgroup keepalive test failed during step '${currentStep}': ${
            error instanceof Error ? error.message : String(error)
          }${diagnostics.length === 0 ? "" : ` Diagnostics: ${diagnostics.join(" | ")}`}`,
        );
      } finally {
        await persistentPty?.close().catch(() => {});
        await killDetachedProcessIfPresent({
          fixture,
          authenticatedSession,
          sandboxInstanceId,
          detachedPid,
        });
      }
    },
    SYSTEM_TEST_TIMEOUT_MS,
  );
});

function shellQuote(input: string): string {
  return `'${input.replaceAll("'", `'\\''`)}'`;
}

function stripTerminalControlSequences(input: string): string {
  return input.replaceAll(TERMINAL_CONTROL_SEQUENCE_PATTERN, "");
}

async function openPersistentPtySession(input: {
  fixture: CodexSandboxFixture;
  authenticatedSession: CodexSandboxAuthenticatedSession;
  sandboxInstanceId: string;
  cwd: string;
}): Promise<PersistentPtySession> {
  const connectionUrl = await mintSandboxConnectionUrl({
    fixture: input.fixture,
    authenticatedSession: input.authenticatedSession,
    sandboxInstanceId: input.sandboxInstanceId,
  });
  const runtime = input.fixture.createSessionRuntime?.();
  if (runtime === undefined) {
    throw new Error("Persistent PTY session requires a sandbox session runtime.");
  }

  const transport = new SandboxSessionTransport({
    runtime,
    connectTimeoutMs: 120_000,
  });
  const ptyClient = new PtyStreamClient({
    transport,
    closeTimeoutMs: 3_000,
  });
  let closed = false;
  let output = "";
  let streamError: Error | undefined;

  ptyClient.onData((chunk) => {
    output += Buffer.from(chunk).toString("utf8");
  });
  ptyClient.onError((error) => {
    streamError = error;
  });
  ptyClient.onReset((resetInfo) => {
    streamError = new Error(`Sandbox PTY reset (${resetInfo.code}): ${resetInfo.message}`);
  });

  try {
    await transport.connect({
      connectionUrl,
    });
    await ptyClient.connect();
    await ptyClient.open({
      ptySessionId: `cgroup-keepalive-${randomUUID()}`,
      cols: 120,
      rows: 40,
      cwd: input.cwd,
      command: "sh",
    });
  } catch (error) {
    transport.disconnect(1000, "system test persistent PTY setup failed");
    throw error;
  }

  return {
    write: async (payload) => {
      await ptyClient.write(payload);
    },
    waitForOutputMatch: async ({ pattern, timeoutMs }) => {
      const deadlineEpochMs = Date.now() + timeoutMs;
      while (Date.now() < deadlineEpochMs) {
        if (streamError !== undefined) {
          throw streamError;
        }

        const normalizedOutput = stripTerminalControlSequences(output).replaceAll("\r", "");
        const match = normalizedOutput.match(pattern);
        if (match !== null) {
          return match;
        }

        await systemSleeper.sleep(Math.min(OUTPUT_POLL_INTERVAL_MS, deadlineEpochMs - Date.now()));
      }

      throw new Error(`Timed out after ${String(timeoutMs)}ms waiting for PTY output match.`);
    },
    close: async () => {
      if (closed) {
        return;
      }
      closed = true;
      await ptyClient.disconnect();
      transport.disconnect(1000, "system test persistent PTY cleanup");
    },
  };
}

async function captureDetachedProcessCgroupDiagnostics(input: {
  fixture: CodexSandboxFixture;
  authenticatedSession: CodexSandboxAuthenticatedSession;
  sandboxInstanceId: string;
  detachedPid: string;
}): Promise<{ exitCode: number; output: string }> {
  const result = await runSandboxExecCommandInSandbox({
    fixture: input.fixture,
    authenticatedSession: input.authenticatedSession,
    sandboxInstanceId: input.sandboxInstanceId,
    command: "sh",
    args: [
      "-c",
      [
        "printf 'PROC_CGROUP\\n'",
        `cat /proc/${input.detachedPid}/cgroup`,
        "printf 'MISTLE_EVENTS\\n'",
        "find /sys/fs/cgroup/mistle -path '*/user/*/cgroup.events' -print -exec cat {} \\; 2>/dev/null",
      ].join("; "),
    ],
  });

  return {
    exitCode: result.exitCode,
    output: result.stdout,
  };
}

async function collectFailureDiagnostics(input: {
  fixture: CodexSandboxFixture;
  authenticatedSession: CodexSandboxAuthenticatedSession | undefined;
  sandboxInstanceId: string | undefined;
  detachedPid: string | undefined;
  detachedProcessCgroupProbe: { exitCode: number; output: string } | undefined;
}): Promise<string[]> {
  const diagnostics: string[] = [];
  if (input.sandboxInstanceId !== undefined) {
    try {
      const runtimeState = await input.fixture.readSandboxRuntimeState(input.sandboxInstanceId);
      diagnostics.push(`runtimeState=${JSON.stringify(runtimeState)}`);
    } catch (diagnosticError) {
      diagnostics.push(
        `runtimeStateError=${
          diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError)
        }`,
      );
    }
  }

  if (
    input.sandboxInstanceId === undefined ||
    input.detachedPid === undefined ||
    input.authenticatedSession === undefined
  ) {
    return diagnostics;
  }

  if (input.detachedProcessCgroupProbe !== undefined) {
    diagnostics.push(`capturedCgroupProbe=${JSON.stringify(input.detachedProcessCgroupProbe)}`);
  }

  try {
    const cgroupProbe = await captureDetachedProcessCgroupDiagnostics({
      fixture: input.fixture,
      authenticatedSession: input.authenticatedSession,
      sandboxInstanceId: input.sandboxInstanceId,
      detachedPid: input.detachedPid,
    });
    diagnostics.push(`cgroupProbe=${JSON.stringify(cgroupProbe)}`);
  } catch (diagnosticError) {
    diagnostics.push(
      `cgroupProbeError=${
        diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError)
      }`,
    );
  }

  return diagnostics;
}

async function killDetachedProcessIfPresent(input: {
  fixture: CodexSandboxFixture;
  authenticatedSession: CodexSandboxAuthenticatedSession | undefined;
  sandboxInstanceId: string | undefined;
  detachedPid: string | undefined;
}): Promise<void> {
  if (
    input.authenticatedSession === undefined ||
    input.sandboxInstanceId === undefined ||
    input.detachedPid === undefined
  ) {
    return;
  }

  await runSandboxExecCommandInSandbox({
    fixture: input.fixture,
    authenticatedSession: input.authenticatedSession,
    sandboxInstanceId: input.sandboxInstanceId,
    command: "sh",
    args: ["-c", `kill ${input.detachedPid} >/dev/null 2>&1 || true`],
  }).catch(() => undefined);
}
