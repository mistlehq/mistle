import type { SessionComposerModelSelectionInput } from "./session-composer/index.js";
import type { SessionTerminalContentInset } from "./session-terminal-surface.js";
import type { SessionMainPanelRuntimeId } from "./use-session-main-panel-handoff.js";

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
} satisfies Record<string, SessionRuntimeWorkbenchCapability>;
