import type { CodexThreadSummary } from "@mistle/integrations-definitions/agent-runtimes/codex/client";
import { describe, expect, it } from "vitest";

import { selectPreferredThreadId } from "./thread-selection.js";

function createThread(input: {
  id: string;
  createdAt: number | null;
  updatedAt?: number | null;
  parentThreadId?: string | null;
  threadSource?: string | null;
  isSubagent?: boolean;
}): CodexThreadSummary {
  const hasParent = input.parentThreadId !== undefined && input.parentThreadId !== null;
  const threadSource = input.threadSource ?? (hasParent ? "subagent" : null);
  const hasSubagentThreadSource =
    threadSource === "subagent" || (threadSource?.startsWith("subAgent") ?? false);
  return {
    id: input.id,
    name: null,
    preview: null,
    parentThreadId: input.parentThreadId ?? null,
    threadSource,
    isSubagent: input.isSubagent ?? (hasParent || hasSubagentThreadSource),
    agentNickname: null,
    agentRole: null,
    cwd: "/root",
    updatedAt: input.updatedAt ?? null,
    createdAt: input.createdAt,
  };
}

describe("selectPreferredThreadId", () => {
  it("prefers the oldest created loaded thread when details are available", () => {
    const result = selectPreferredThreadId({
      availableThreads: [
        createThread({
          id: "thread_old",
          updatedAt: 10,
          createdAt: 1,
        }),
        createThread({
          id: "thread_new",
          updatedAt: 20,
          createdAt: 2,
        }),
      ],
      loadedThreadIds: ["thread_old", "thread_new"],
    });

    expect(result).toBe("thread_old");
  });

  it("falls back to the first loaded thread when it is missing from the available list", () => {
    const result = selectPreferredThreadId({
      availableThreads: [],
      loadedThreadIds: ["thread_loaded_only"],
    });

    expect(result).toBe("thread_loaded_only");
  });

  it("falls back to the oldest created available thread when nothing is loaded", () => {
    const result = selectPreferredThreadId({
      availableThreads: [
        createThread({
          id: "thread_a",
          updatedAt: null,
          createdAt: 10,
        }),
        createThread({
          id: "thread_b",
          updatedAt: 30,
          createdAt: 5,
        }),
      ],
      loadedThreadIds: [],
    });

    expect(result).toBe("thread_b");
  });

  it("returns null when no thread can be selected", () => {
    const result = selectPreferredThreadId({
      availableThreads: [],
      loadedThreadIds: [],
    });

    expect(result).toBeNull();
  });

  it("prefers the most recently updated available thread when requested", () => {
    const result = selectPreferredThreadId({
      availableThreads: [
        createThread({
          id: "thread_old_but_active",
          updatedAt: 30,
          createdAt: 1,
        }),
        createThread({
          id: "thread_newer_but_stale",
          updatedAt: 20,
          createdAt: 2,
        }),
      ],
      loadedThreadIds: [],
      selectionPolicy: "most_recently_updated",
    });

    expect(result).toBe("thread_old_but_active");
  });

  it("falls back to the first loaded-only thread id when most recent update is requested", () => {
    const result = selectPreferredThreadId({
      availableThreads: [],
      loadedThreadIds: ["thread_old_loaded", "thread_new_loaded"],
      selectionPolicy: "most_recently_updated",
    });

    expect(result).toBe("thread_old_loaded");
  });

  it("keeps a loaded-only thread ahead of available roots without metadata proving it is a subagent", () => {
    const result = selectPreferredThreadId({
      availableThreads: [
        createThread({
          id: "thread_root",
          updatedAt: 10,
          createdAt: 2,
        }),
      ],
      loadedThreadIds: ["thread_loaded_only"],
    });

    expect(result).toBe("thread_loaded_only");
  });

  it("still prefers the most recently updated loaded thread when details are available", () => {
    const result = selectPreferredThreadId({
      availableThreads: [
        createThread({
          id: "thread_old_loaded",
          updatedAt: 10,
          createdAt: 1,
        }),
        createThread({
          id: "thread_new_loaded",
          updatedAt: 20,
          createdAt: 2,
        }),
      ],
      loadedThreadIds: ["thread_old_loaded", "thread_new_loaded"],
      selectionPolicy: "most_recently_updated",
    });

    expect(result).toBe("thread_new_loaded");
  });

  it("excludes subagent threads from inferred default selection", () => {
    const result = selectPreferredThreadId({
      availableThreads: [
        createThread({
          id: "thread_subagent",
          parentThreadId: "thread_parent",
          updatedAt: 100,
          createdAt: 1,
        }),
        createThread({
          id: "thread_root",
          updatedAt: 10,
          createdAt: 2,
        }),
      ],
      loadedThreadIds: ["thread_subagent", "thread_root"],
    });

    expect(result).toBe("thread_root");
  });

  it("excludes source-only subagent threads from inferred default selection", () => {
    const result = selectPreferredThreadId({
      availableThreads: [
        createThread({
          id: "thread_subagent",
          threadSource: "subagent",
          updatedAt: 100,
          createdAt: 1,
        }),
        createThread({
          id: "thread_root",
          updatedAt: 10,
          createdAt: 2,
        }),
      ],
      loadedThreadIds: ["thread_subagent", "thread_root"],
    });

    expect(result).toBe("thread_root");
  });
});
