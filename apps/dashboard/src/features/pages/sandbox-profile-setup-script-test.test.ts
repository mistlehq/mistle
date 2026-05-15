import { describe, expect, it } from "vitest";

import {
  resolveSetupScriptTestStatus,
  resolveSetupScriptTestStatusMessage,
} from "./sandbox-profile-setup-script-test.js";

describe("resolveSetupScriptTestStatus", () => {
  it("reports success when the setup-check sandbox reaches running", () => {
    expect(
      resolveSetupScriptTestStatus({
        runErrorMessage: null,
        sandboxStatus: "running",
        scriptIsBlank: false,
        startIsPending: false,
        startedRun: {
          sandboxInstanceId: "sbi_setup_test_1",
          setupScript: "pnpm install",
          workflowRunId: "owfr_setup_test_1",
        },
        terminalResult: null,
      }),
    ).toBe("success");
  });

  it("reports success when the setup-check sandbox is stopped after worker cleanup", () => {
    expect(
      resolveSetupScriptTestStatus({
        runErrorMessage: null,
        sandboxStatus: "stopped",
        scriptIsBlank: false,
        startIsPending: false,
        startedRun: {
          sandboxInstanceId: "sbi_setup_test_1",
          setupScript: "pnpm install",
          workflowRunId: "owfr_setup_test_1",
        },
        terminalResult: null,
      }),
    ).toBe("success");
  });

  it("reports failed when sandbox status lookup fails before completion", () => {
    expect(
      resolveSetupScriptTestStatus({
        runErrorMessage: "Could not check setup script test sandbox status.",
        sandboxStatus: null,
        scriptIsBlank: false,
        startIsPending: false,
        startedRun: {
          sandboxInstanceId: "sbi_setup_test_1",
          setupScript: "pnpm install",
          workflowRunId: "owfr_setup_test_1",
        },
        terminalResult: null,
      }),
    ).toBe("failed");
  });

  it("reports blank only when there is no active setup script test run", () => {
    expect(
      resolveSetupScriptTestStatus({
        runErrorMessage: null,
        sandboxStatus: null,
        scriptIsBlank: true,
        startIsPending: false,
        startedRun: null,
        terminalResult: null,
      }),
    ).toBe("blank");
  });

  it("keeps an active setup script test visible when the editor is cleared", () => {
    expect(
      resolveSetupScriptTestStatus({
        runErrorMessage: null,
        sandboxStatus: "pending",
        scriptIsBlank: true,
        startIsPending: false,
        startedRun: {
          sandboxInstanceId: "sbi_setup_test_1",
          setupScript: "pnpm install",
          workflowRunId: "owfr_setup_test_1",
        },
        terminalResult: null,
      }),
    ).toBe("starting");
  });

  it("keeps a running setup script test visible when the editor is cleared", () => {
    expect(
      resolveSetupScriptTestStatus({
        runErrorMessage: null,
        sandboxStatus: "starting",
        scriptIsBlank: true,
        startIsPending: false,
        startedRun: {
          sandboxInstanceId: "sbi_setup_test_1",
          setupScript: "pnpm install",
          workflowRunId: "owfr_setup_test_1",
        },
        terminalResult: null,
      }),
    ).toBe("running");
  });
});

describe("resolveSetupScriptTestStatusMessage", () => {
  it("does not render a summary without a specific error", () => {
    expect(
      resolveSetupScriptTestStatusMessage({
        runErrorMessage: null,
        sandboxFailureMessage: null,
      }),
    ).toBeNull();
  });

  it("keeps platform error messages visible", () => {
    expect(
      resolveSetupScriptTestStatusMessage({
        runErrorMessage: "Could not check setup script test sandbox status.",
        sandboxFailureMessage: null,
      }),
    ).toBe("Could not check setup script test sandbox status.");
  });
});
