import { describe, expect, it } from "vitest";

import {
  createSetupScriptTestShellPayload,
  resolveSetupScriptTestStatusMessage,
} from "./sandbox-profile-setup-script-test.js";

describe("createSetupScriptTestShellPayload", () => {
  it("enables fail-fast execution before the user setup script when requested", () => {
    expect(
      createSetupScriptTestShellPayload({
        failOnFirstError: true,
        setupScript: "pnpm install\npnpm dev:bootstrap",
      }),
    ).toBe("set -e\npnpm install\npnpm dev:bootstrap");
  });

  it("runs the user setup script unchanged when fail-fast execution is disabled", () => {
    expect(
      createSetupScriptTestShellPayload({
        failOnFirstError: false,
        setupScript: "#!/usr/bin/env bash\npnpm install || npm install",
      }),
    ).toBe("#!/usr/bin/env bash\npnpm install || npm install");
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
