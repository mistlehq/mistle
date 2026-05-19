import { describe, expect, it } from "vitest";

import {
  createConfirmedThreadSearchParams,
  resolveThreadNavigatorPanelVisibility,
} from "./use-session-workbench-thread-navigation.js";

describe("createConfirmedThreadSearchParams", () => {
  it("writes the selected thread id explicitly when a user confirms thread navigation", () => {
    const searchParams = new URLSearchParams("panel=threads");

    const nextSearchParams = createConfirmedThreadSearchParams({
      searchParams,
      threadId: "thread_default",
    });

    expect(nextSearchParams.get("threadId")).toBe("thread_default");
    expect(nextSearchParams.get("panel")).toBe("threads");
  });

  it("replaces a previous thread id with the newly confirmed thread id", () => {
    const searchParams = new URLSearchParams("threadId=thread_previous");

    const nextSearchParams = createConfirmedThreadSearchParams({
      searchParams,
      threadId: "thread_selected",
    });

    expect(nextSearchParams.get("threadId")).toBe("thread_selected");
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
