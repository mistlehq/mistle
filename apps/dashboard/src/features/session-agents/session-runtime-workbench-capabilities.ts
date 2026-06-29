import {
  AgentRuntimeIdCatalog,
  type AgentRuntimeId,
} from "@mistle/integrations-definitions/agent-runtimes/catalog";

import type { SessionComposerModelSelectionInput } from "../pages/session-composer/index.js";
import type { SessionTerminalContentInset } from "../pages/session-terminal-surface.js";

type SessionRuntimeWorkbenchCapability = {
  runtimeId: AgentRuntimeId;
  displayName: string;
  cliTerminalContentInset: SessionTerminalContentInset;
  composerModelSelection: SessionComposerModelSelectionInput;
  supportsSteering: boolean;
  preservesCliLaunchContext: boolean;
};

export const SessionRuntimeWorkbenchCapabilities = {
  CODEX: {
    runtimeId: AgentRuntimeIdCatalog.CODEX,
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
    runtimeId: AgentRuntimeIdCatalog.CLAUDE_CODE,
    displayName: "Claude Code",
    cliTerminalContentInset: "none",
    composerModelSelection: {
      required: false,
      showControls: true,
    },
    supportsSteering: true,
    preservesCliLaunchContext: false,
  },
  OPENCODE: {
    runtimeId: AgentRuntimeIdCatalog.OPENCODE,
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
    runtimeId: AgentRuntimeIdCatalog.PI,
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
