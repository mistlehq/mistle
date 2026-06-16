import type { SessionComposerModelSelectionInput } from "../pages/session-composer/index.js";
import type { SessionTerminalContentInset } from "../pages/session-terminal-surface.js";
import type { SessionMainPanelRuntimeId } from "../pages/use-session-main-panel-handoff.js";

type SessionRuntimeWorkbenchCapability = {
  runtimeId: SessionMainPanelRuntimeId;
  displayName: string;
  cliTerminalContentInset: SessionTerminalContentInset;
  composerModelSelection: SessionComposerModelSelectionInput;
  supportsSteering: boolean;
  preservesCliLaunchContext: boolean;
};

export const SessionRuntimeWorkbenchCapabilities = {
  CODEX: {
    runtimeId: "codex",
    displayName: "Codex",
    cliTerminalContentInset: "default",
    composerModelSelection: {
      required: true,
      showControls: true,
    },
    supportsSteering: true,
    preservesCliLaunchContext: false,
  },
  CLAUDE_CODE: {
    runtimeId: "claude-code",
    displayName: "Claude Code",
    cliTerminalContentInset: "none",
    composerModelSelection: {
      required: false,
      showControls: false,
    },
    supportsSteering: true,
    preservesCliLaunchContext: false,
  },
  OPENCODE: {
    runtimeId: "opencode",
    displayName: "OpenCode",
    cliTerminalContentInset: "none",
    composerModelSelection: {
      required: false,
      showControls: true,
    },
    supportsSteering: true,
    preservesCliLaunchContext: true,
  },
  PI: {
    runtimeId: "pi",
    displayName: "Pi",
    cliTerminalContentInset: "none",
    composerModelSelection: {
      required: false,
      showControls: true,
    },
    supportsSteering: true,
    preservesCliLaunchContext: false,
  },
} satisfies Record<string, SessionRuntimeWorkbenchCapability>;
