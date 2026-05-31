/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended Vitest fixture created by the system test harness.
 */

import { describe, expect } from "vitest";

import {
  prepareCodexSandbox,
  resumeSandboxInstance,
  runSandboxExecCommandInSandbox,
  stopSandboxInstanceByUserRequest,
  waitForRuntimeReadyValue,
  waitForSandboxConnectable,
  waitForSandboxStatus,
  type CodexSandboxAuthenticatedSession,
  type CodexSandboxFixture,
  type SandboxExecResult,
} from "../system/helpers/codex-sandbox.js";
import { createRuntimeCodexSandboxFixture } from "./helpers/runtime-codex-sandbox.js";
import { createSandboxSystemTest } from "./helpers/sandbox-system-test.js";
import { timeSystemRuntimePhase } from "./helpers/system-runtime-phase-timing.js";

const it = createSandboxSystemTest({
  extraInfra: ["mailpit"],
  sandboxProviders: ["e2b", "tensorlake"],
  dataPlaneWorker: {
    sandboxdArtifactResolver: "release",
  },
  publicAccess: {
    provider: "cloudflare",
    services: ["data-plane-gateway"],
  },
});

const SYSTEM_TEST_TIMEOUT_MS = 10 * 60_000;
const STOP_RUNTIME_READY_TIMEOUT_MS = 90_000;
const RESUME_PUBLIC_ACCESS_READY_TIMEOUT_MS = 30_000;
const RESUME_SANDBOX_STATUS_TIMEOUT_MS = 8 * 60_000;
const ForcedOldSandboxdVersion = "0.0.0-system-test-old";

describe("runtime system sandbox resume refreshes sandboxd after stale egress rules", () => {
  it(
    "downloads the release sandboxd artifact when a resumed sandbox has an older binary shim",
    async ({ sandboxProvider, system }) => {
      const fixture = createRuntimeCodexSandboxFixture(system);
      const timingAttributes = { sandboxProvider };

      const { authenticatedSession, sandboxInstanceId } = await timeSystemRuntimePhase({
        event: "system_runtime.sandbox_resume_refreshes_sandboxd.phase_timing",
        phase: "prepare_sandbox",
        attributes: timingAttributes,
        operation: async () =>
          await prepareCodexSandbox({
            fixture,
            email: "runtime-sandbox-resume-refreshes-sandboxd@example.com",
          }),
      });

      const expectedSandboxdVersion = await timeSystemRuntimePhase({
        event: "system_runtime.sandbox_resume_refreshes_sandboxd.phase_timing",
        phase: "read_initial_sandboxd_version",
        attributes: timingAttributes,
        operation: async () =>
          await runSandboxShellCommandOrThrow({
            fixture,
            authenticatedSession,
            sandboxInstanceId,
            script: "/opt/mistle/bin/sandboxd version",
            description: "read initial sandboxd version",
          }),
      });
      expect(expectedSandboxdVersion).not.toBe(ForcedOldSandboxdVersion);

      await timeSystemRuntimePhase({
        event: "system_runtime.sandbox_resume_refreshes_sandboxd.phase_timing",
        phase: "verify_transparent_egress_rules_present",
        attributes: timingAttributes,
        operation: async () =>
          await runSandboxShellCommandOrThrow({
            fixture,
            authenticatedSession,
            sandboxInstanceId,
            script: `
run_as_root() {
  if test "$(id -u)" -eq 0; then
    "$@"
  else
    sudo -n "$@"
  fi
}

run_as_root nft list table ip mistle_transparent_egress >/dev/null
printf 'present\\n'
`.trim(),
            description: "verify transparent egress nftables table",
          }),
      });

      const shimmedSandboxdVersion = await timeSystemRuntimePhase({
        event: "system_runtime.sandbox_resume_refreshes_sandboxd.phase_timing",
        phase: "install_old_sandboxd_shim",
        attributes: timingAttributes,
        operation: async () =>
          await runSandboxShellCommandOrThrow({
            fixture,
            authenticatedSession,
            sandboxInstanceId,
            script: `
run_as_root() {
  if test "$(id -u)" -eq 0; then
    "$@"
  else
    sudo -n "$@"
  fi
}

shim_path="/tmp/mistle-sandboxd-old-shim"
cat >"$shim_path" <<'SHIM'
#!/bin/sh
if test "\${1:-}" = "version"; then
  printf '%s\\n' '${ForcedOldSandboxdVersion}'
  exit 0
fi

echo "system-test sandboxd shim only supports version" >&2
exit 127
SHIM
chmod 0755 "$shim_path"
run_as_root install -m 0755 "$shim_path" /opt/mistle/bin/sandboxd
run_as_root ln -sf sandboxd /opt/mistle/bin/mistle-ssh-sign
/opt/mistle/bin/sandboxd version
`.trim(),
            description: "install old sandboxd shim",
          }),
      });
      expect(shimmedSandboxdVersion).toBe(ForcedOldSandboxdVersion);

      await timeSystemRuntimePhase({
        event: "system_runtime.sandbox_resume_refreshes_sandboxd.phase_timing",
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
        event: "system_runtime.sandbox_resume_refreshes_sandboxd.phase_timing",
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
        event: "system_runtime.sandbox_resume_refreshes_sandboxd.phase_timing",
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
        event: "system_runtime.sandbox_resume_refreshes_sandboxd.phase_timing",
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
        event: "system_runtime.sandbox_resume_refreshes_sandboxd.phase_timing",
        phase: "check_public_access_ready_before_resume",
        attributes: timingAttributes,
        operation: async () =>
          await publicAccess.checkReady({
            timeoutMs: RESUME_PUBLIC_ACCESS_READY_TIMEOUT_MS,
          }),
      });

      await timeSystemRuntimePhase({
        event: "system_runtime.sandbox_resume_refreshes_sandboxd.phase_timing",
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
        event: "system_runtime.sandbox_resume_refreshes_sandboxd.phase_timing",
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
      await timeSystemRuntimePhase({
        event: "system_runtime.sandbox_resume_refreshes_sandboxd.phase_timing",
        phase: "wait_runtime_ready_true",
        attributes: timingAttributes,
        operation: async () =>
          await waitForRuntimeReadyValue({
            fixture,
            sandboxInstanceId,
            expectedReady: true,
            timeoutMs: STOP_RUNTIME_READY_TIMEOUT_MS,
          }),
      });

      const refreshedSandboxdVersion = await timeSystemRuntimePhase({
        event: "system_runtime.sandbox_resume_refreshes_sandboxd.phase_timing",
        phase: "read_refreshed_sandboxd_version",
        attributes: timingAttributes,
        operation: async () =>
          await runSandboxShellCommandOrThrow({
            fixture,
            authenticatedSession,
            sandboxInstanceId,
            script: "/opt/mistle/bin/sandboxd version",
            description: "read refreshed sandboxd version",
          }),
      });
      expect(refreshedSandboxdVersion).toBe(expectedSandboxdVersion);
    },
    SYSTEM_TEST_TIMEOUT_MS,
  );
});

async function runSandboxShellCommandOrThrow(input: {
  fixture: CodexSandboxFixture;
  authenticatedSession: CodexSandboxAuthenticatedSession;
  sandboxInstanceId: string;
  script: string;
  description: string;
}): Promise<string> {
  const result = await runSandboxExecCommandInSandbox({
    fixture: input.fixture,
    authenticatedSession: input.authenticatedSession,
    sandboxInstanceId: input.sandboxInstanceId,
    command: "sh",
    args: ["-euc", input.script],
    timeoutMs: 30_000,
  });
  assertSandboxExecSucceeded(result, input.description);
  return result.stdout.trim();
}

function assertSandboxExecSucceeded(result: SandboxExecResult, description: string): void {
  if (result.exitCode === 0) {
    return;
  }

  throw new Error(
    `${description} failed with exit code ${String(result.exitCode)}. stdout=${result.stdout} stderr=${result.stderr}`,
  );
}

function readPublicAccessOrThrow(system: Parameters<typeof createRuntimeCodexSandboxFixture>[0]) {
  const { publicAccess } = system;
  if (publicAccess === undefined) {
    throw new Error("Sandboxd refresh runtime system test requires public access diagnostics.");
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
        event:
          "sandbox_resume_refreshes_sandboxd.public_access_diagnostics_after_resume_wait_failure",
        sandboxInstanceId: input.sandboxInstanceId,
        sandboxProvider: input.sandboxProvider,
        resumeStatusTimeoutMs: RESUME_SANDBOX_STATUS_TIMEOUT_MS,
        publicAccessDiagnostics: await input.publicAccess.readDiagnostics(),
      }),
    );
    throw error;
  }
}
