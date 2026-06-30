import {
  AgentRuntimeIdCatalog,
  isAgentRuntimeId,
  type AgentRuntimeId,
} from "@mistle/integrations-definitions/agent-runtimes/catalog";

import type { SessionComposerModelSelectionInput } from "../pages/session-composer/index.js";
import type { SessionTerminalContentInset } from "../pages/session-terminal-surface.js";

export type SessionRuntimeWorkbenchCapability = {
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

export const SessionRuntimeWorkbenchCapabilitiesByRuntimeId = {
  [AgentRuntimeIdCatalog.CLAUDE_CODE]: SessionRuntimeWorkbenchCapabilities.CLAUDE_CODE,
  [AgentRuntimeIdCatalog.CODEX]: SessionRuntimeWorkbenchCapabilities.CODEX,
  [AgentRuntimeIdCatalog.OPENCODE]: SessionRuntimeWorkbenchCapabilities.OPENCODE,
  [AgentRuntimeIdCatalog.PI]: SessionRuntimeWorkbenchCapabilities.PI,
} satisfies Record<AgentRuntimeId, SessionRuntimeWorkbenchCapability>;

export function resolveSessionWorkbenchRuntimeId(input: {
  runtimeAgentRuntimeId: string | null | undefined;
}): AgentRuntimeId {
  if (input.runtimeAgentRuntimeId === null || input.runtimeAgentRuntimeId === undefined) {
    // The runtime id is absent while sandbox status is loading and for older Codex sessions.
    return AgentRuntimeIdCatalog.CODEX;
  }

  if (!isAgentRuntimeId(input.runtimeAgentRuntimeId)) {
    throw new Error(
      `Unsupported session workbench agent runtime '${input.runtimeAgentRuntimeId}'.`,
    );
  }

  return input.runtimeAgentRuntimeId;
}

export function getSessionRuntimeWorkbenchCapabilities(input: {
  runtimeId: AgentRuntimeId;
}): SessionRuntimeWorkbenchCapability {
  return SessionRuntimeWorkbenchCapabilitiesByRuntimeId[input.runtimeId];
}
