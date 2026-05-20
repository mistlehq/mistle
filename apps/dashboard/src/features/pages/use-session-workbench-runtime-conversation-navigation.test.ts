import { describe, expect, it } from "vitest";

import {
  createConfirmedRuntimeConversationSearchParams,
  resolveRuntimeConversationNavigatorPanelVisibility,
} from "./use-session-workbench-runtime-conversation-navigation.js";

describe("createConfirmedRuntimeConversationSearchParams", () => {
  it("writes the selected conversation id explicitly when a user confirms conversation navigation", () => {
    const searchParams = new URLSearchParams("panel=conversations");

    const nextSearchParams = createConfirmedRuntimeConversationSearchParams({
      searchParams,
      runtimeConversationId: "conversation_default",
    });

    expect(nextSearchParams.get("conversationId")).toBe("conversation_default");
    expect(nextSearchParams.get("panel")).toBe("conversations");
  });

  it("replaces a previous conversation id with the newly confirmed conversation id", () => {
    const searchParams = new URLSearchParams("conversationId=conversation_previous");

    const nextSearchParams = createConfirmedRuntimeConversationSearchParams({
      searchParams,
      runtimeConversationId: "conversation_selected",
    });

    expect(nextSearchParams.get("conversationId")).toBe("conversation_selected");
  });

  it("removes the legacy thread id parameter when confirming provider-neutral conversation navigation", () => {
    const searchParams = new URLSearchParams("threadId=thread_legacy&panel=conversations");

    const nextSearchParams = createConfirmedRuntimeConversationSearchParams({
      searchParams,
      runtimeConversationId: "conversation_selected",
    });

    expect(nextSearchParams.get("conversationId")).toBe("conversation_selected");
    expect(nextSearchParams.has("threadId")).toBe(false);
    expect(nextSearchParams.get("panel")).toBe("conversations");
  });
});

describe("resolveRuntimeConversationNavigatorPanelVisibility", () => {
  it("opens runtime conversation navigation by default when more than one unarchived conversation is available", () => {
    expect(
      resolveRuntimeConversationNavigatorPanelVisibility({
        explicitPanelVisibility: null,
        isDiffPanelVisible: false,
        conversationCount: 2,
      }),
    ).toBe(true);
  });

  it("keeps runtime conversation navigation closed by default for one unarchived conversation", () => {
    expect(
      resolveRuntimeConversationNavigatorPanelVisibility({
        explicitPanelVisibility: null,
        isDiffPanelVisible: false,
        conversationCount: 1,
      }),
    ).toBe(false);
  });

  it("does not auto-open runtime conversation navigation over a visible diff panel", () => {
    expect(
      resolveRuntimeConversationNavigatorPanelVisibility({
        explicitPanelVisibility: null,
        isDiffPanelVisible: true,
        conversationCount: 2,
      }),
    ).toBe(false);
  });

  it("keeps runtime conversation navigation closed when the user explicitly closed it", () => {
    expect(
      resolveRuntimeConversationNavigatorPanelVisibility({
        explicitPanelVisibility: false,
        isDiffPanelVisible: false,
        conversationCount: 3,
      }),
    ).toBe(false);
  });

  it("keeps runtime conversation navigation open when the user explicitly opened it", () => {
    expect(
      resolveRuntimeConversationNavigatorPanelVisibility({
        explicitPanelVisibility: true,
        isDiffPanelVisible: true,
        conversationCount: 1,
      }),
    ).toBe(true);
  });
});
