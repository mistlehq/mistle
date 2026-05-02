import { describe, expect, it } from "vitest";

import { SandboxBaseRuntimeShell } from "./sandbox-base-inventory-copy.js";
import {
  createSetupScriptTestShellPayload,
  resolveSetupScriptTestStatus,
  resolveSetupScriptTestStatusMessage,
} from "./sandbox-profile-setup-script-test.js";

describe("createSetupScriptTestShellPayload", () => {
  it("enables fail-fast execution before the user setup script when requested", () => {
    const payload = createSetupScriptTestShellPayload({
      failOnFirstError: true,
      setupScript: "pnpm install\npnpm dev:bootstrap",
    });

    expect(payload).toContain("base64 -d");
    expect(payload).toContain(`${SandboxBaseRuntimeShell} -l -e`);
  });

  it("runs non-shebang scripts without fail-fast shell options when disabled", () => {
    const payload = createSetupScriptTestShellPayload({
      failOnFirstError: false,
      setupScript: "pnpm install || npm install",
    });

    expect(payload).toContain("base64 -d");
    expect(payload).toContain(`${SandboxBaseRuntimeShell} -l`);
    expect(payload).not.toContain(`${SandboxBaseRuntimeShell} -l -e`);
  });

  it("executes shebang scripts directly from the generated script file", () => {
    const payload = createSetupScriptTestShellPayload({
      failOnFirstError: true,
      setupScript: "#!/usr/bin/env python3\nprint('hello')",
    });

    expect(payload).toContain('if head -c 2 "$setup_script_path" | grep -q "^#!"; then');
    expect(payload).toContain('  "$setup_script_path"');
    expect(payload).toContain('  exit "$?"');
  });
});

describe("resolveSetupScriptTestStatus", () => {
  it("prefers the terminal exit result over later sandbox status errors", () => {
    expect(
      resolveSetupScriptTestStatus({
        isOpenRequested: false,
        ptyErrorMessage: null,
        ptyExitCode: 0,
        runErrorMessage: "Sandbox instance 'sbi_test' was not found.",
        scriptIsBlank: false,
        startIsPending: false,
        startedRun: {
          failOnFirstError: true,
          ptySessionId: "setup-script-test-1",
          sandboxInstanceId: "sbi_setup_test_1",
          setupScript: "pnpm install",
        },
      }),
    ).toBe("success");
  });

  it("reports blank only when there is no active setup script test run", () => {
    expect(
      resolveSetupScriptTestStatus({
        isOpenRequested: false,
        ptyErrorMessage: null,
        ptyExitCode: null,
        runErrorMessage: null,
        scriptIsBlank: true,
        startIsPending: false,
        startedRun: null,
      }),
    ).toBe("blank");
  });

  it("keeps an active setup script test visible when the editor is cleared", () => {
    expect(
      resolveSetupScriptTestStatus({
        isOpenRequested: false,
        ptyErrorMessage: null,
        ptyExitCode: null,
        runErrorMessage: null,
        scriptIsBlank: true,
        startIsPending: false,
        startedRun: {
          failOnFirstError: true,
          ptySessionId: "setup-script-test-1",
          sandboxInstanceId: "sbi_setup_test_1",
          setupScript: "pnpm install",
        },
      }),
    ).toBe("starting");
  });

  it("keeps a running setup script test visible when the editor is cleared", () => {
    expect(
      resolveSetupScriptTestStatus({
        isOpenRequested: true,
        ptyErrorMessage: null,
        ptyExitCode: null,
        runErrorMessage: null,
        scriptIsBlank: true,
        startIsPending: false,
        startedRun: {
          failOnFirstError: true,
          ptySessionId: "setup-script-test-1",
          sandboxInstanceId: "sbi_setup_test_1",
          setupScript: "pnpm install",
        },
      }),
    ).toBe("running");
  });
});

describe("resolveSetupScriptTestStatusMessage", () => {
  it("does not render a summary without a specific error", () => {
    expect(
      resolveSetupScriptTestStatusMessage({
        ptyErrorMessage: null,
        runErrorMessage: null,
        sandboxFailureMessage: null,
      }),
    ).toBeNull();
  });

  it("keeps platform error messages visible", () => {
    expect(
      resolveSetupScriptTestStatusMessage({
        ptyErrorMessage: null,
        runErrorMessage: "Could not check setup script test sandbox status.",
        sandboxFailureMessage: null,
      }),
    ).toBe("Could not check setup script test sandbox status.");
  });
});
