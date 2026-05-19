import { describe, expect, it } from "vitest";

import { createInitialOpenCodeChatState, type OpenCodeChatState } from "./opencode-chat-state.js";
import {
  buildOpenCodeComposerConfigResetKey,
  buildRefreshingOpenCodeComposerBootstrap,
  mapOpenCodeChatStateForConversation,
  resolveOpenCodePromptModelOverride,
} from "./opencode-workbench-composer.js";

function createOpenCodeChatState(input: {
  sessionId: string | null;
  status: OpenCodeChatState["status"];
}): OpenCodeChatState {
  return {
    ...createInitialOpenCodeChatState(),
    sessionId: input.sessionId,
    status: input.status,
  };
}

describe("OpenCode workbench composer adapter", () => {
  it("omits prompt model overrides until the user selects a model", () => {
    expect(resolveOpenCodePromptModelOverride(false, "openai/gpt-5")).toBeUndefined();
    expect(resolveOpenCodePromptModelOverride(true, null)).toBeUndefined();
    expect(resolveOpenCodePromptModelOverride(true, "openai/gpt-5")).toEqual({
      providerID: "openai",
      modelID: "gpt-5",
    });
  });

  it("keys composer model overrides by sandbox and session", () => {
    expect(buildOpenCodeComposerConfigResetKey("sbi_one", "ses_one")).toBe("sbi_one:ses_one");
    expect(buildOpenCodeComposerConfigResetKey(null, null)).toBe(":");
  });

  it("maps a busy OpenCode chat state to an in-progress conversation state", () => {
    expect(
      mapOpenCodeChatStateForConversation(
        createOpenCodeChatState({
          sessionId: "ses_one",
          status: "busy",
        }),
      ),
    ).toEqual({
      activeTurnId: "ses_one",
      entries: [],
      pendingTurnId: null,
      status: "inProgress",
    });
  });

  it("maps idle OpenCode chat state without an active turn", () => {
    expect(
      mapOpenCodeChatStateForConversation(
        createOpenCodeChatState({
          sessionId: "ses_one",
          status: "idle",
        }),
      ),
    ).toEqual({
      activeTurnId: null,
      entries: [],
      pendingTurnId: null,
      status: "idle",
    });
  });

  it("builds the refreshing composer bootstrap state", () => {
    expect(buildRefreshingOpenCodeComposerBootstrap()).toEqual({
      phase: { status: "bootstrapping" },
      composerCapabilities: [],
      establishedSnapshot: {
        availableModels: [],
        configSnapshot: {
          model: null,
          modelReasoningEffort: null,
        },
      },
    });
  });
});
