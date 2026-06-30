import { describe, expect, it } from "vitest";

import {
  getSessionWorkbenchRuntimeModule,
  resolveSessionWorkbenchRuntimeId,
  SessionWorkbenchRuntimeModules,
} from "./session-workbench-runtime-registry.js";

describe("session workbench runtime registry", () => {
  it("describes the Codex workbench contract", () => {
    expect(SessionWorkbenchRuntimeModules.CODEX).toEqual({
      runtimeId: "codex",
      metadata: {
        displayName: "Codex",
      },
      presentation: {
        cliTerminalContentInset: "default",
      },
      composerPolicy: {
        composerModelSelection: {
          required: true,
          showControls: true,
        },
        supportsSteering: true,
      },
      handoffPolicy: {
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
    });
  });

  it("describes the Claude Code workbench contract", () => {
    expect(SessionWorkbenchRuntimeModules.CLAUDE_CODE).toEqual({
      runtimeId: "claude-code",
      metadata: {
        displayName: "Claude Code",
      },
      presentation: {
        cliTerminalContentInset: "none",
      },
      composerPolicy: {
        composerModelSelection: {
          required: false,
          showControls: true,
        },
        supportsSteering: true,
      },
      handoffPolicy: {
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
    });
  });

  it("describes the OpenCode workbench contract", () => {
    expect(SessionWorkbenchRuntimeModules.OPENCODE).toEqual({
      runtimeId: "opencode",
      metadata: {
        displayName: "OpenCode",
      },
      presentation: {
        cliTerminalContentInset: "none",
      },
      composerPolicy: {
        composerModelSelection: {
          required: false,
          showControls: true,
        },
        supportsSteering: true,
      },
      handoffPolicy: {
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
    });
  });

  it("describes the Pi workbench contract", () => {
    expect(SessionWorkbenchRuntimeModules.PI).toEqual({
      runtimeId: "pi",
      metadata: {
        displayName: "Pi",
      },
      presentation: {
        cliTerminalContentInset: "none",
      },
      composerPolicy: {
        composerModelSelection: {
          required: false,
          showControls: true,
        },
        supportsSteering: true,
      },
      handoffPolicy: {
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
    });
  });

  it("resolves known runtime ids through the workbench registry", () => {
    expect(
      getSessionWorkbenchRuntimeModule({
        runtimeId: resolveSessionWorkbenchRuntimeId({
          runtimeAgentRuntimeId: "opencode",
        }),
      }),
    ).toBe(SessionWorkbenchRuntimeModules.OPENCODE);
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
