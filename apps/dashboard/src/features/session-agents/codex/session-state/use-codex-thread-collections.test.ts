import type { CodexThreadSummary } from "@mistle/integrations-definitions/agent-runtimes/codex/client";
import { describe, expect, it } from "vitest";

import {
  resolveOriginalCodexThreadId,
  resolveOriginalThreadIdSnapshotAfterThreadStart,
  resolveReusableOriginalThreadIdSnapshot,
} from "./use-codex-thread-collections.js";

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
    cwd: "/workspace/repo",
    createdAt: input.createdAt,
    updatedAt: input.updatedAt ?? null,
  };
}

describe("resolveOriginalCodexThreadId", () => {
  it("selects the earliest created thread across visible and archived thread candidates", () => {
    expect(
      resolveOriginalCodexThreadId([
        createThread({ id: "thread_visible", createdAt: 30 }),
        createThread({ id: "thread_archived", createdAt: 10 }),
        createThread({ id: "thread_recent", createdAt: 50 }),
      ]),
    ).toBe("thread_archived");
  });

  it("uses the thread id as a deterministic tiebreaker when creation times match", () => {
    expect(
      resolveOriginalCodexThreadId([
        createThread({ id: "thread_b", createdAt: 10 }),
        createThread({ id: "thread_a", createdAt: 10 }),
      ]),
    ).toBe("thread_a");
  });

  it("excludes Codex subagent threads from original thread inference", () => {
    expect(
      resolveOriginalCodexThreadId([
        createThread({
          id: "thread_subagent",
          createdAt: 1,
          parentThreadId: "thread_parent",
        }),
        createThread({ id: "thread_root", createdAt: 10 }),
      ]),
    ).toBe("thread_root");
  });

  it("returns null when every candidate is a Codex subagent thread", () => {
    expect(
      resolveOriginalCodexThreadId([
        createThread({
          id: "thread_subagent",
          createdAt: 1,
          parentThreadId: "thread_parent",
        }),
      ]),
    ).toBeNull();
  });

  it("excludes source-only Codex subagent threads from original thread inference", () => {
    expect(
      resolveOriginalCodexThreadId([
        createThread({
          id: "thread_subagent",
          createdAt: 1,
          threadSource: "subagent",
        }),
        createThread({ id: "thread_root", createdAt: 10 }),
      ]),
    ).toBe("thread_root");
  });
});

describe("resolveReusableOriginalThreadIdSnapshot", () => {
  it("does not reuse a null original snapshot because the first thread may have been created later", () => {
    expect(
      resolveReusableOriginalThreadIdSnapshot({
        refreshGeneration: 1,
        snapshot: {
          generation: 1,
          threadId: null,
        },
      }),
    ).toBeNull();
  });

  it("reuses a non-null snapshot only for the matching connection generation", () => {
    expect(
      resolveReusableOriginalThreadIdSnapshot({
        refreshGeneration: 2,
        snapshot: {
          generation: 1,
          threadId: "thread_original",
        },
      }),
    ).toBeNull();

    expect(
      resolveReusableOriginalThreadIdSnapshot({
        refreshGeneration: 1,
        snapshot: {
          generation: 1,
          threadId: "thread_original",
        },
      }),
    ).toEqual({
      generation: 1,
      threadId: "thread_original",
    });
  });
});

describe("resolveOriginalThreadIdSnapshotAfterThreadStart", () => {
  it("records an auto-started thread as original after a same-generation empty scan", () => {
    expect(
      resolveOriginalThreadIdSnapshotAfterThreadStart({
        generation: 1,
        snapshot: {
          generation: 1,
          threadId: null,
        },
        startedThreadId: "thread_started",
      }),
    ).toEqual({
      generation: 1,
      threadId: "thread_started",
    });
  });

  it("preserves existing and stale-generation original snapshots", () => {
    const existingSnapshot = {
      generation: 1,
      threadId: "thread_original",
    };
    expect(
      resolveOriginalThreadIdSnapshotAfterThreadStart({
        generation: 1,
        snapshot: existingSnapshot,
        startedThreadId: "thread_started",
      }),
    ).toBe(existingSnapshot);

    const staleSnapshot = {
      generation: 1,
      threadId: null,
    };
    expect(
      resolveOriginalThreadIdSnapshotAfterThreadStart({
        generation: 2,
        snapshot: staleSnapshot,
        startedThreadId: "thread_started",
      }),
    ).toBe(staleSnapshot);
  });
});
