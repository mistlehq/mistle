import { describe, expect, it } from "vitest";

import {
  createConfirmedRuntimeConversationSearchParams,
  resolveThreadNavigatorPanelVisibility,
} from "./use-session-workbench-thread-navigation.js";

describe("createConfirmedRuntimeConversationSearchParams", () => {
  it("writes the selected conversation id explicitly when a user confirms conversation navigation", () => {
    const searchParams = new URLSearchParams("panel=threads");

    const nextSearchParams = createConfirmedRuntimeConversationSearchParams({
      searchParams,
      runtimeConversationId: "thread_default",
    });

    expect(nextSearchParams.get("conversationId")).toBe("thread_default");
    expect(nextSearchParams.get("panel")).toBe("threads");
  });

  it("replaces a previous conversation id with the newly confirmed conversation id", () => {
    const searchParams = new URLSearchParams("conversationId=thread_previous");

    const nextSearchParams = createConfirmedRuntimeConversationSearchParams({
      searchParams,
      runtimeConversationId: "thread_selected",
    });

    expect(nextSearchParams.get("conversationId")).toBe("thread_selected");
  });

  it("removes the legacy thread id parameter when confirming provider-neutral conversation navigation", () => {
    const searchParams = new URLSearchParams("threadId=thread_legacy&panel=threads");

    const nextSearchParams = createConfirmedRuntimeConversationSearchParams({
      searchParams,
      runtimeConversationId: "thread_selected",
    });

    expect(nextSearchParams.get("conversationId")).toBe("thread_selected");
    expect(nextSearchParams.has("threadId")).toBe(false);
    expect(nextSearchParams.get("panel")).toBe("threads");
  });
});

describe("resolveThreadNavigatorPanelVisibility", () => {
  it("opens Codex thread navigation by default when more than one unarchived thread is available", () => {
    expect(
      resolveThreadNavigatorPanelVisibility({
        explicitPanelVisibility: null,
        isDiffPanelVisible: false,
        unarchivedThreadCount: 2,
      }),
    ).toBe(true);
  });

  it("keeps Codex thread navigation closed by default for one unarchived thread", () => {
    expect(
      resolveThreadNavigatorPanelVisibility({
        explicitPanelVisibility: null,
        isDiffPanelVisible: false,
        unarchivedThreadCount: 1,
      }),
    ).toBe(false);
  });

  it("does not auto-open Codex thread navigation over a visible diff panel", () => {
    expect(
      resolveThreadNavigatorPanelVisibility({
        explicitPanelVisibility: null,
        isDiffPanelVisible: true,
        unarchivedThreadCount: 2,
      }),
    ).toBe(false);
  });

  it("keeps Codex thread navigation closed when the user explicitly closed it", () => {
    expect(
      resolveThreadNavigatorPanelVisibility({
        explicitPanelVisibility: false,
        isDiffPanelVisible: false,
        unarchivedThreadCount: 3,
      }),
    ).toBe(false);
  });

  it("keeps Codex thread navigation open when the user explicitly opened it", () => {
    expect(
      resolveThreadNavigatorPanelVisibility({
        explicitPanelVisibility: true,
        isDiffPanelVisible: true,
        unarchivedThreadCount: 1,
      }),
    ).toBe(true);
  });
});
