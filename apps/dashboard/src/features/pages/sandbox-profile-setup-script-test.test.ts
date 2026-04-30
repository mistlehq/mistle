import { describe, expect, it } from "vitest";

import {
  createSetupScriptTestShellPayload,
  resolveSetupScriptTestStatusMessage,
} from "./sandbox-profile-setup-script-test.js";

describe("createSetupScriptTestShellPayload", () => {
  it("enables fail-fast execution before the user setup script when requested", () => {
    const payload = createSetupScriptTestShellPayload({
      failOnFirstError: true,
      setupScript: "pnpm install\npnpm dev:bootstrap",
    });

    expect(payload).toContain("base64 -d");
    expect(payload).toContain("exec /bin/bash -l -e");
  });

  it("runs non-shebang scripts without fail-fast shell options when disabled", () => {
    const payload = createSetupScriptTestShellPayload({
      failOnFirstError: false,
      setupScript: "pnpm install || npm install",
    });

    expect(payload).toContain("base64 -d");
    expect(payload).toContain("exec /bin/bash -l");
    expect(payload).not.toContain("exec /bin/bash -l -e");
  });

  it("executes shebang scripts directly from the generated script file", () => {
    const payload = createSetupScriptTestShellPayload({
      failOnFirstError: true,
      setupScript: "#!/usr/bin/env python3\nprint('hello')",
    });

    expect(payload).toContain('if head -c 2 "$setup_script_path" | grep -q "^#!"; then');
    expect(payload).toContain('  exec "$setup_script_path"');
  });
});

describe("resolveSetupScriptTestStatusMessage", () => {
  it("does not summarize setup script exit codes without a more specific error", () => {
    expect(
      resolveSetupScriptTestStatusMessage({
        ptyErrorMessage: null,
        ptyExitCode: 127,
        runErrorMessage: null,
        sandboxFailureMessage: null,
      }),
    ).toBeNull();
  });

  it("keeps platform error messages visible", () => {
    expect(
      resolveSetupScriptTestStatusMessage({
        ptyErrorMessage: null,
        ptyExitCode: null,
        runErrorMessage: "Could not check setup script test sandbox status.",
        sandboxFailureMessage: null,
      }),
    ).toBe("Could not check setup script test sandbox status.");
  });
});
