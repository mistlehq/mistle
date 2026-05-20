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
  hasContextUsage: boolean;
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
    hasContextUsage: true,
  },
  OPENCODE: {
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
    preservesCliLaunchContext: true,
    hasContextUsage: false,
  },
} satisfies Record<string, SessionRuntimeWorkbenchCapability>;
