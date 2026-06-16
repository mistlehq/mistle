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
    });
  });

  it("describes the Claude Code workbench contract", () => {
    expect(SessionRuntimeWorkbenchCapabilities.CLAUDE_CODE).toEqual({
      runtimeId: "claude-code",
      displayName: "Claude Code",
      cliTerminalContentInset: "none",
      composerModelSelection: {
        required: false,
        showControls: false,
      },
      supportsSteering: true,
      preservesCliLaunchContext: false,
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
      supportsSteering: true,
      preservesCliLaunchContext: true,
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
      preservesCliLaunchContext: false,
    });
  });
});
