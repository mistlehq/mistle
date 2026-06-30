import { describe, expect, it } from "vitest";

import {
  getSessionRuntimeWorkbenchCapabilities,
  resolveSessionWorkbenchRuntimeId,
  SessionRuntimeWorkbenchCapabilities,
} from "./session-runtime-workbench-capabilities.js";

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
        showControls: true,
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

  it("resolves known runtime ids through the workbench registry", () => {
    expect(
      getSessionRuntimeWorkbenchCapabilities({
        runtimeId: resolveSessionWorkbenchRuntimeId({
          runtimeAgentRuntimeId: "opencode",
        }),
      }),
    ).toBe(SessionRuntimeWorkbenchCapabilities.OPENCODE);
  });

  it("uses Codex while the runtime id is not loaded", () => {
    expect(
      resolveSessionWorkbenchRuntimeId({
        runtimeAgentRuntimeId: undefined,
      }),
    ).toBe("codex");
    expect(
      resolveSessionWorkbenchRuntimeId({
        runtimeAgentRuntimeId: null,
      }),
    ).toBe("codex");
  });

  it("rejects unknown runtime ids instead of falling back to Codex", () => {
    expect(() =>
      resolveSessionWorkbenchRuntimeId({
        runtimeAgentRuntimeId: "unknown-runtime",
      }),
    ).toThrow("Unsupported session workbench agent runtime 'unknown-runtime'.");
  });
});
