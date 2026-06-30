import {
  AgentRuntimeIdCatalog,
  isAgentRuntimeId,
  type AgentRuntimeId,
} from "@mistle/integrations-definitions/agent-runtimes/catalog";

import type { SessionComposerModelSelectionInput } from "../pages/session-composer/index.js";
import type { SessionTerminalContentInset } from "../pages/session-terminal-surface.js";

export type SessionRuntimeWorkbenchCapability = {
  displayName: string;
  cliTerminalContentInset: SessionTerminalContentInset;
  composerModelSelection: SessionComposerModelSelectionInput;
  supportsSteering: boolean;
  preservesCliLaunchContext: boolean;
};

type SessionWorkbenchRuntimeRepositoryPolicy = {
  blocksPrimaryRepositorySwitchWhileCliActive: boolean;
  usesCodexActiveThreadCwd: boolean;
};

type SessionWorkbenchRuntimeConversationPolicy = {
  enablesOpenCodeComposerState: boolean;
  usesCodexActiveRuntimeConversationId: boolean;
};

export type SessionWorkbenchRuntimeModule = {
  runtimeId: AgentRuntimeId;
  capabilities: SessionRuntimeWorkbenchCapability;
  conversationPolicy: SessionWorkbenchRuntimeConversationPolicy;
  repositoryPolicy: SessionWorkbenchRuntimeRepositoryPolicy;
};

export const SessionWorkbenchRuntimeModules = {
  CODEX: {
    runtimeId: AgentRuntimeIdCatalog.CODEX,
    capabilities: {
      displayName: "Codex",
      cliTerminalContentInset: "default",
      composerModelSelection: {
        required: true,
        showControls: true,
      },
      supportsSteering: true,
      preservesCliLaunchContext: false,
    },
    conversationPolicy: {
      enablesOpenCodeComposerState: false,
      usesCodexActiveRuntimeConversationId: true,
    },
    repositoryPolicy: {
      blocksPrimaryRepositorySwitchWhileCliActive: true,
      usesCodexActiveThreadCwd: true,
    },
  },
  CLAUDE_CODE: {
    runtimeId: AgentRuntimeIdCatalog.CLAUDE_CODE,
    capabilities: {
      displayName: "Claude Code",
      cliTerminalContentInset: "none",
      composerModelSelection: {
        required: false,
        showControls: true,
      },
      supportsSteering: true,
      preservesCliLaunchContext: false,
    },
    conversationPolicy: {
      enablesOpenCodeComposerState: false,
      usesCodexActiveRuntimeConversationId: false,
    },
    repositoryPolicy: {
      blocksPrimaryRepositorySwitchWhileCliActive: false,
      usesCodexActiveThreadCwd: false,
    },
  },
  OPENCODE: {
    runtimeId: AgentRuntimeIdCatalog.OPENCODE,
    capabilities: {
      displayName: "OpenCode",
      cliTerminalContentInset: "none",
      composerModelSelection: {
        required: false,
        showControls: true,
      },
      supportsSteering: true,
      preservesCliLaunchContext: true,
    },
    conversationPolicy: {
      enablesOpenCodeComposerState: true,
      usesCodexActiveRuntimeConversationId: false,
    },
    repositoryPolicy: {
      blocksPrimaryRepositorySwitchWhileCliActive: false,
      usesCodexActiveThreadCwd: false,
    },
  },
  PI: {
    runtimeId: AgentRuntimeIdCatalog.PI,
    capabilities: {
      displayName: "Pi",
      cliTerminalContentInset: "none",
      composerModelSelection: {
        required: false,
        showControls: true,
      },
      supportsSteering: true,
      preservesCliLaunchContext: false,
    },
    conversationPolicy: {
      enablesOpenCodeComposerState: false,
      usesCodexActiveRuntimeConversationId: false,
    },
    repositoryPolicy: {
      blocksPrimaryRepositorySwitchWhileCliActive: false,
      usesCodexActiveThreadCwd: false,
    },
  },
} satisfies Record<string, SessionWorkbenchRuntimeModule>;

export const SessionWorkbenchRuntimeModulesByRuntimeId = {
  [AgentRuntimeIdCatalog.CLAUDE_CODE]: SessionWorkbenchRuntimeModules.CLAUDE_CODE,
  [AgentRuntimeIdCatalog.CODEX]: SessionWorkbenchRuntimeModules.CODEX,
  [AgentRuntimeIdCatalog.OPENCODE]: SessionWorkbenchRuntimeModules.OPENCODE,
  [AgentRuntimeIdCatalog.PI]: SessionWorkbenchRuntimeModules.PI,
} satisfies Record<AgentRuntimeId, SessionWorkbenchRuntimeModule>;

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

export function getSessionWorkbenchRuntimeModule(input: {
  runtimeId: AgentRuntimeId;
}): SessionWorkbenchRuntimeModule {
  return SessionWorkbenchRuntimeModulesByRuntimeId[input.runtimeId];
}
