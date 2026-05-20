import { describe, expect, it } from "vitest";

import { SessionRuntimeWorkbenchCapabilities } from "./session-runtime-workbench-capabilities.js";

describe("SessionRuntimeWorkbenchCapabilities", () => {
  it("describes the Codex workbench contract", () => {
    expect(SessionRuntimeWorkbenchCapabilities.CODEX).toEqual({
      runtimeId: "codex",
      displayName: "Codex",
      cliTerminalContentInset: "default",
      composerModelSelection: {
        required: true,
        showControls: true,
      },
      supportsSteering: true,
      preservesCliLaunchContext: false,
      hasContextUsage: true,
    });
  });

  it("describes the OpenCode workbench contract", () => {
    expect(SessionRuntimeWorkbenchCapabilities.OPENCODE).toEqual({
      runtimeId: "opencode",
      displayName: "OpenCode",
      cliTerminalContentInset: "none",
      composerModelSelection: {
        required: false,
        showControls: true,
      },
      supportsSteering: false,
      preservesCliLaunchContext: true,
      hasContextUsage: false,
    });
  });

  it("describes the Pi workbench contract", () => {
    expect(SessionRuntimeWorkbenchCapabilities.PI).toEqual({
      runtimeId: "pi",
      displayName: "Pi",
      cliTerminalContentInset: "none",
      composerModelSelection: {
        required: false,
        showControls: true,
      },
      supportsSteering: true,
      preservesCliLaunchContext: true,
      hasContextUsage: false,
    });
  });
});
