import { describe, expect, it } from "vitest";

import {
  projectCodexThreadNavigatorRows,
  resolveDefaultCodexThreadId,
} from "./codex-thread-navigator-model.js";

const Threads = [
  {
    id: "thread_old",
    name: "Old work",
    preview: "Preview",
    cwd: "/workspace/repo-a",
    createdAt: 10,
    updatedAt: 20,
  },
  {
    id: "thread_new",
    name: null,
    preview: "New work\nsecond line",
    cwd: "/workspace/repo-a",
    createdAt: 30,
    updatedAt: 50,
  },
  {
    id: "thread_other_repo",
    name: null,
    preview: null,
    cwd: "/workspace/repo-b",
    createdAt: 40,
    updatedAt: 60,
  },
];

describe("projectCodexThreadNavigatorRows", () => {
  it("orders all threads by recent activity and marks row metadata", () => {
    expect(
      projectCodexThreadNavigatorRows({
        activeThreadId: "thread_new",
        availableThreads: Threads,
        loadedThreadIds: ["thread_new"],
        pendingThreadId: "thread_old",
        pendingServerRequestThreadIds: ["thread_new", "thread_new"],
      }),
    ).toEqual([
      {
        id: "thread_other_repo",
        title: "Untitled thread",
        preview: null,
        cwd: "/workspace/repo-b",
        cwdSectionLabel: "repo-b",
        createdAt: 40,
        updatedAt: 60,
        isActive: false,
        isLoaded: false,
        isOpening: false,
        isPinnedCurrent: false,
        pendingServerRequestCount: 0,
      },
      {
        id: "thread_new",
        title: "New work",
        preview: "New work\nsecond line",
        cwd: "/workspace/repo-a",
        cwdSectionLabel: "repo-a",
        createdAt: 30,
        updatedAt: 50,
        isActive: true,
        isLoaded: true,
        isOpening: false,
        isPinnedCurrent: false,
        pendingServerRequestCount: 2,
      },
      {
        id: "thread_old",
        title: "Old work",
        preview: "Preview",
        cwd: "/workspace/repo-a",
        cwdSectionLabel: "repo-a",
        createdAt: 10,
        updatedAt: 20,
        isActive: false,
        isLoaded: false,
        isOpening: true,
        isPinnedCurrent: false,
        pendingServerRequestCount: 0,
      },
    ]);
  });

  it("does not need to pin the active thread because all threads are visible", () => {
    expect(
      projectCodexThreadNavigatorRows({
        activeThreadId: "thread_other_repo",
        availableThreads: Threads,
        loadedThreadIds: [],
        pendingThreadId: null,
        pendingServerRequestThreadIds: [],
      }).map((row) => ({
        id: row.id,
        isPinnedCurrent: row.isPinnedCurrent,
      })),
    ).toEqual([
      {
        id: "thread_other_repo",
        isPinnedCurrent: false,
      },
      {
        id: "thread_new",
        isPinnedCurrent: false,
      },
      {
        id: "thread_old",
        isPinnedCurrent: false,
      },
    ]);
  });

  it("resolves the default thread from recent activity", () => {
    expect(
      resolveDefaultCodexThreadId({
        availableThreads: Threads,
      }),
    ).toBe("thread_other_repo");
  });
});
