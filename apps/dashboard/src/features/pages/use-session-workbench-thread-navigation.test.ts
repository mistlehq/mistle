import { describe, expect, it } from "vitest";

import { createConfirmedThreadSearchParams } from "./use-session-workbench-thread-navigation.js";

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
